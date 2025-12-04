import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { deleteInvoiceData, getInvoiceData, putInvoicePath, postInvoiceData, postJobData, getJobs, putJobData, putInvoiceClaveId, getAuthorizedDomains, getPermitedExtensions } from './db.js';
import axios from 'axios';
import FormData from "form-data";
import { fileURLToPath } from 'url';
import { simpleParser } from 'mailparser';
import path, { parse } from 'path';
import qs from 'qs';
import 'dotenv/config';
import c from 'config';

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
        deleteInvoiceData(invoice.Id);
        if (invoice.Ruta != '') {
            await fsp.rm(invoice.Ruta, { recursive: true, force: true });
        }
    } catch (error) {
        console.log(error);
    }
}


async function processAttachment (attachment, from, mailBox) {
    let DocId = 0;
    let docPath = '';
    try{
        const filename = attachment.filename;
        console.log('Procesando adjunto: ' + attachment.filename)
        
        if (filename) {
            DocId = await postInvoiceData(from, mailBox);

            if(!DocId){
                throw new Error('No se pudo insertar el registro de la factura en la base de datos');
            }

            if(process.env.DEBUG === "true"){
                docPath = path.join(__dirname, 'temp', DocId.toString());
                console.log('Estamos en debug y la ruta es: ' + docPath)
            }else{
                docPath = path.join(process.env.DOC_PATH, DocId.toString());
                console.log('Estamos en prod y la ruta es: ' + docPath)
            }
            
            await mkdir(docPath, { recursive: true });
            const idDocPath = path.join(docPath, `DocOrigen.pdf`);
            await writeFile(idDocPath, attachment.content);

            const pathResult = await putInvoicePath(DocId, idDocPath);

            if(!pathResult){
                throw new Error('No se pudo actualizar la ruta de la factura en la base de datos');
            }

            return { Id: DocId, Ruta: idDocPath};
        }
    }catch(error){
        if(DocId != 0){
            deleteInvoice({ Id: DocId, Ruta: docPath });
        }
        throw error;
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

async function sendInvoiceAI(invoice, isRescan = false){
    try {
        let IdEmpotencyKey = `${Date.now()}-${invoice.Id}`;

        let data = new FormData();
        data.append('id', `${invoice.Id}`);
        data.append('file', fs.createReadStream(invoice.Ruta));
        data.append('webhook_url', `${process.env.API_PUBLICA}${process.env.WEBHOOK_URL}` ?? '');
        data.append('webhook_secret', '');
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
            "rescan": isRescan
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

        const result = await postJobData(response.data.job_id, IdEmpotencyKey, response.data.status, invoice.Id)
        const resultClaveId = await putInvoiceClaveId(invoice.Id, IdEmpotencyKey);

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


                                            const domainResultset = await getAuthorizedDomains()
                                            const extResultset = await getPermitedExtensions()

                                            

                                            if(!domainResultset.find(domain => parsed.from.value[0].address.toLocaleLowerCase().endsWith(`@${domain.Dominio.toLowerCase()}`))){
                                                console.log('Mail de dominio no autorizado, saltando procesamiento.');
                                                return;
                                            }

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

                                                    const invoice = await processAttachment(file, parsed.from.value[0].address, account.user)
                                                                        .catch(err => {
                                                                                console.error('Error procesando adjunto:', err.message);
                                                                                errored = true;
                                                                            });
                                                    
                                                    if(invoice && invoice.Id){
                                                        inserted.push(invoice);   
                                                    }
                                                }

                                                if(errored){
                                                    removeInsertedInvoices(inserted);
                                                    moveToErrorBox(imap, seqno);
                                                    console.log('Error procesando adjuntos, moviendo correo a REVISAR');
                                                }else{
                                                    let result = []
                                                    
                                                    for(const insertedInvoice of inserted){
                                                        const data = await getInvoiceData(insertedInvoice.Id);

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
    sendHealthCheckAI
};