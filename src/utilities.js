import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { exec } from 'child_process';
import { deleteInvoiceData, getInvoiceData, putInvoicePath, postInvoiceData, postJobData, getJobs, putJobData, putInvoiceClaveId, getAuthorizedDomains, getPermitedExtensions,
    getLicense,
 } from './db.js';
import axios from 'axios';
import FormData from "form-data";
import { fileURLToPath } from 'url';
import { simpleParser } from 'mailparser';
import path, { parse } from 'path';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fileToBase64(path) {
    try {
        const data = await readFile(path);
        return data.toString('base64');
    } catch (err) {
        console.error('Error leyendo el archivo:', err);
    }
}

async function deleteInvoice(invoice) {
    try {
        deleteInvoiceData(invoice.DocId);
        if (invoice.Ruta != '') {
            await fsp.rm(invoice.Ruta, { recursive: true, force: true });
        }
    } catch (error) {
        console.log(error);
    }
}


async function processAttachment (attachment, from, mailBox, isDomainAuthorized) {
    let DocId = 0;
    try{
        const filename = attachment.filename;
        console.log('Procesando adjunto: ' + attachment.filename)
        
        if (filename) {

            let situacionEspecial = 2;//Dominio no autorizado = 2

            if(isDomainAuthorized){
                situacionEspecial = null;
            }

            console.log('Insertando, situacion especial final: ' + situacionEspecial);

            const Invoice = {
                From: from, 
                MailBox: mailBox, 
                SituacionEspecial: situacionEspecial
            }

            const result = await createInvoice(Invoice, attachment.content);

            return { DocId: result.DocId, Ruta: result.Ruta};
        }
    }catch(error){
        // Si hay algún error elimina tanto los ficheros como la entrada en la base de datos
        if(DocId != 0){
            deleteInvoice({ DocId: DocId, Ruta: docPath });
        }
        throw error;
    }
}

async function createInvoice(Invoice, file){
    const data = {
        DocId: null,
        Ruta: ''
    }
    try {
        // Crear entrada en la base de datos y obtener el DocId
        data.DocId = await postInvoiceData(Invoice.From, Invoice.MailBox, Invoice.SituacionEspecial);

        if(!data.DocId){
            return data;
        }

        if(process.env.DEBUG === "true"){
            //Guardar en carpeta temp dentro del src para debug
            data.Ruta = path.join(__dirname, 'temp', data.DocId.toString());
        }else{
            //Guardar en la carpeta de documentos flexy definida en las variables de entorno
            data.Ruta = path.join(process.env.DOC_PATH, data.DocId.toString());
        }

        await mkdir(data.Ruta, { recursive: true });
        const idDocPath = path.join(data.Ruta, `DocOrigen.pdf`);
        await writeFile(idDocPath, file);
        const pathResult = await putInvoicePath(data.DocId, idDocPath);

        // Dar permisos de escritura a todos los usuarios en Windows para evitar errores en flexygo
        await givePermissions(idDocPath);

        data.Ruta = idDocPath;
        
        if(!pathResult || pathResult?.rowsAffected[0] == 0){
            throw new Error('No se pudo actualizar la ruta del documento en la base de datos');
        }

        return data;
    } catch (error) {
        console.log(error);

        if(data.DocId){
            deleteInvoice({ DocId: data.DocId, Ruta: data.Ruta });
        }
        return data;
    }
}

async function givePermissions(filePath){
    try {
        const cmd = `icacls "${filePath}" /grant *S-1-5-32-545:F`;

        exec(cmd, (err) => {
            if (err) {
                console.error('ACL error:', err.message);
            }
        });
    } catch (error) {
        console.log(error);
    }
}

async function isDomainAuthorized(from){
    try {
        const domainResultset = await getAuthorizedDomains()
                
        let parsedDomain = from.split('@')[1];
        let isDomainAuthorized = false;
                                            
        for(const domain of domainResultset){
            if(domain.Dominio.toLowerCase() == parsedDomain.toLowerCase()){
                console.log('El dominio está autorizado: ' + parsedDomain);
                isDomainAuthorized = true;
                break;
            }
        }

        return isDomainAuthorized;
    } catch (error) {
        console.log(error);
        return false;
    }
}

function removeInsertedInvoices(inserted){
    try {
        for(const insertedInvoice of inserted){
            deleteInvoice(insertedInvoice);
        }
    } catch (error) {
        console.log(error);
    }
}


async function moveToErrorBox(imap, seqno) {
    try {
        if (seqno) {
            console.log('Moviendo correo a la carpeta REVISAR');
            imap.seq.move(seqno, 'REVISAR', (err) => {
                if (err){ 
                    console.log('Error marcando como flagged:', err.message);
                }else{
                    console.log('Correo movido a la carpeta REVISAR');
                }
            });
        }
    } catch (error) {
        console.log(error);
    }
}

async function markSeen(imap, seqno) {
    try {
        if (seqno) {
            imap.seq.addFlags(seqno, ['\\Seen'], (err) => {
                if (err) {
                    console.log('Error marcando como leído:', err.message);
                } else {
                    console.log('Correo marcado como leído');
                }
            });
        }
    } catch (error) {
        console.log(error);
    }
}


async function markUnseen(imap, seqno) {
    try {
        if (seqno) {
            imap.seq.delFlags(seqno, ['\\Seen'], (err) => {
                if (err) {
                    console.log('Error marcando como no leído:', err.message);
                } else {
                    console.log('Correo marcado como no leído');
                }
            });
        }
    } catch (error) {
        console.log(error);
    }
}

async function readFileBuffer(filePath){
    try {
        const file = await readFile(filePath);
        return file;
    } catch (error) {
        return false;
    }
}

async function sendInvoiceAI(invoice, isRescan = false){
    try {
        let IdEmpotencyKey = `${Date.now()}-${invoice.DocId}`;
        console.log(invoice);

        let licenseId = await getLicense();
        console.log('LicenseId obtenida: ' + licenseId);

        let data = new FormData();
        data.append('id', `${invoice.DocId}`);
        data.append('file', fs.createReadStream(invoice.Ruta));
        data.append('webhook_url', `${process.env.API_PUBLICA}/v1/job-reply` ?? '');
        data.append('webhook_secret', 'a');
        data.append('metadata', JSON.stringify({
            "customer": { 
                "name": invoice.CustomerName ?? '',
                "tax_id": invoice.CustomerNif ?? ''
            },
            "supplier": { 
                "name": invoice.SupplierName ?? '',
                "tax_id": invoice.SupplierNif ?? ''
             },
            "handlesProjects": invoice.handlesProjects ?? false,
            "type": invoice.type ?? 'creditor',
            "rescan": isRescan,
            "licenseId": licenseId ?? ''
        }));


        let config = {
        validateStatus: (status) => true,
        method: 'post',
        maxBodyLength: Infinity,
        url: `${process.env.AIHOST}/v1/invoices`,
        headers: { 
            'Idempotency-Key': `${IdEmpotencyKey}`, 
            'Content-Type': 'application/x-www-form-urlencoded', 
            'Accept': 'application/json'
        },
        data : data
        };
        
        //TODO Controlar timeouts y estados para volver a pedir resultado si no se recibe nada
        const response = await axios.request(config);

        if(response.status == 422){
                return false;
        }

        console.log(response.data);

        const result = await postJobData(response.data.job_id, IdEmpotencyKey, response.data.status, invoice.DocId)
        const resultClaveId = await putInvoiceClaveId(invoice.DocId, IdEmpotencyKey);

        if(!result){
            console.log('No se pudo insertar el jobid en la base de datos');
            return false;
        }

        if(!resultClaveId){
            console.log('No se pudo actualizar la claveid en la base de datos');
            return false;
        }
            
        return true;
    } catch (error) {
        console.log('Error enviando la factura a AI:');
        console.log(error)
        return false;
    }
}


async function sendHealthCheckAI(){
    try {
        let config = {
        validateStatus: (status) => true,
        method: 'get',
        maxBodyLength: Infinity,
        url: `${process.env.AIHOST}/health`,
        headers: { 
            'Content-Type': 'application/x-www-form-urlencoded', 
            'Accept': 'application/json'
        },
        
        };
        
        const response = await axios.request(config);

        if(response.data.status == 'healthy'){
            return true;
        }
            
        return false;
    } catch (error) {
        console.log('Error enviando la factura a AI:');
        console.log(error)
        if(error.code === 'ECONNREFUSED'){
            return false;
        }
    }
}


async function getJobStatus(jobId){
    try {
        
        const response = await axios.get(`${process.env.AIHOST}/v1/jobs/${jobId}`);

        return { jobId: response.data.job_id, status: response.data.status, result_url: response.data.result_url };
    } catch (error) {
        console.log('Error enviando la factura a AI:');
        console.log(error)
    }
}

async function getJobResult(resultUrl){
    try {
        
        const response = await axios.get(`${process.env.AIHOST}${resultUrl}`);

        const jsonString = JSON.stringify(response.data);

        return jsonString;
    } catch (error) {
        console.log('Error enviando la factura a AI:');
        console.log(error)
    }
}

async function updateJobResult(){
    try {
        const result = await getJobs();

        for(const job of result.recordset){
            const response = await getJobStatus(job.JobId);
        
            if(response.status == 'SUCCEEDED'){
                const json = await getJobResult(response.result_url);
                await putJobData(job.JobId, json, response.status);
            }
        }
    } catch (error) {
        console.log(error)
    }
}


function createErrorMailBox(imap){
    try {
        imap.getBoxes((err, boxes) => {
        if (err) return console.log('Error obteniendo buzones:', err.message);

        if (!boxes['REVISAR']) {
            // Crear buzón Error
            imap.addBox('REVISAR', (err) => {
                if (err) return console.log('Error creando buzón:', err.message);
            });
        }
    });
    }catch(error){
        console.log(error);
    }
}

function startFetchInterval(imap, account){
    try {
        const FETCH_INTERVAL = 2 * 60 * 1000;
        console.log('Creando tarea programada')
        const interval = setInterval(() => {
                if (imap.state !== "authenticated"){
                    console.log('IMAP no está autenticado, no se pueden buscar mensajes.');
                    return;
                } 

                console.log('Leyendo mails desde tarea programada.')
                imap.seq.search(["UNSEEN"], (err, results) => {
                    if (err) {
                        console.error("Error buscando mensajes:", err);
                        return;
                    }

                    if (results.length === 0) {
                        return;
                    }

                    if(!sendHealthCheckAI()){
                        console.log('IA Sin servicio. Se pospone el procesamiento de correos.');
                        return;
                    }
                    
                    const fetch = imap.seq.fetch(results, {
                                    bodies: '',
                                    struct: true,
                                    markSeen: true
                                });

                    fetchMails(fetch, imap, account);

                    fetch.once("error", (err) => console.error("Error en fetch:", err));
                });
            }, FETCH_INTERVAL);
        return interval;
    } catch (error) {
        console.log(error);
    }
}

async function fetchMails(fetch, imap, account){
    try {
        fetch.once('message', function (msg, seqno) {
                                msg.once('body', function (stream) {
                                    simpleParser(stream, async (err, parsed) => {
                                        try{
                                            console.log('Leyendo cuerpo del correo.')
                                            
                                            if (err) {
                                                moveToErrorBox(imap, seqno);

                                                console.error('Error parseando mensaje:', err.message);
                                                return;
                                            }

                                            // Obtener las extensiones y dominios permitidos
                                            const extResultset = await getPermitedExtensions()
                                            const from = parsed.from.value[0].address;
                                            let isAuthorized = await isDomainAuthorized(from);

                                            console.log('¿Dominio autorizado? ' + isAuthorized);

                                            if (parsed.attachments && parsed.attachments.length > 0) {
                                                const inserted = [];
                                                let errored = false;
                                                
                                                for(const file of parsed.attachments){
                                                    console.log('Leyendo documento: ' + file.filename)

                                                    const extension = file.filename.split('.').pop().toLowerCase();
                                                    const contentType = file.contentType.split('/').pop().toLowerCase();

                                                    const isCorrectExtension = extResultset.find(ext => ext.TipoArchivo.toLowerCase() == extension);
                                                    const isCorrectContentType = extResultset.find(ext => ext.TipoArchivo.toLowerCase() == contentType);

                                                    if(!isCorrectExtension && !isCorrectContentType){
                                                        console.log(`La extensión y el tipo son incorrectos, pasando al siguiente fichero. Id: ${file.contentId}, Nombre: ${file.filename}`);
                                                        continue;
                                                    }

                                                    const fileSizeKB = file.size / 1024;
                                                    console.log('Tamaño del fichero en kb: ' + fileSizeKB)
                                                    const maxSizeKB = parseInt(extResultset.find(ext => ext.TipoArchivo.toLowerCase() == extension).MaxKilobyte ?? "10000000");
                                                    console.log('Tamaño máximo permitido: ' + maxSizeKB);

                                                    if(maxSizeKB < fileSizeKB){
                                                        console.log(`El tamaño del fichero excede el permitido para la extensión, pasando al siguiente fichero. Id: ${file.contentId}, Nombre: ${file.filename}`);
                                                        continue;
                                                    }

                                                    // Procesar el adjunto
                                                    const invoice = await processAttachment(file, from, account.user, isAuthorized)
                                                                        .catch(err => {
                                                                                console.error('Error procesando adjunto:', err.message);
                                                                                errored = true;
                                                                        });
                                                    
                                                    // Guardar la factura insertada para posibles eliminaciones posteriores si hay errores
                                                    if(invoice && invoice.DocId){
                                                        inserted.push(invoice);   
                                                    }
                                                }

                                                // Gestión de errores y estados finales
                                                if(errored){
                                                    removeInsertedInvoices(inserted);
                                                    moveToErrorBox(imap, seqno);
                                                    console.log('Error procesando adjuntos, moviendo correo a REVISAR');
                                                }else if(!isAuthorized){
                                                    markSeen(imap, seqno);
                                                    console.log('Dominio no autorizado, marcando correo como leído sin enviar a IA.');
                                                }else{
                                                    let result = []
                                                    
                                                    // Aquí se hacen muchas comprobaciones pero son necesarias.
                                                    // La idea es que si hay un error en el envío a la IA, no se gestionen los correos.
                                                    for(const insertedInvoice of inserted){
                                                        const data = await getInvoiceData(insertedInvoice.DocId);

                                                        if(!data){
                                                            result.push(false);
                                                        }else{
                                                            result.push(await sendInvoiceAI(data))
                                                        }
                                                        
                                                    }

                                                    if(result.filter(x => x == false).length > 0){
                                                        removeInsertedInvoices(inserted);
                                                        markUnseen(imap, seqno);
                                                        console.log('Error enviando factura a Facturaitor o actualizando la base de datos');
                                                    }else{
                                                        markSeen(imap, seqno);
                                                    }

                                                }
                                            }
                                        }catch(err){
                                            console.log('Error procesando el correo:');
                                            moveToErrorBox(imap, seqno);
                                            console.error(err)
                                        }
                                    });
                                });
                            });
    } catch (error) {
        console.log(error);
    }
}

export { 
    fileToBase64, 
    deleteInvoice, 
    processAttachment, 
    __dirname, 
    __filename, 
    moveToErrorBox, 
    sendInvoiceAI,
    createErrorMailBox, 
    markSeen,
    getJobStatus,
    getJobResult,
    updateJobResult,
    fetchMails,
    startFetchInterval,
    markUnseen,
    sendHealthCheckAI,
    readFileBuffer,
    createInvoice,
    isDomainAuthorized,
};