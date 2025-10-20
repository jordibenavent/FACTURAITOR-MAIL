import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { deleteInvoiceData, getInvoiceData, putInvoicePath, postInvoiceData, postJobData, getJobs, putJobData, putInvoiceClaveId } from './db.js';
import axios from 'axios';
import FormData from "form-data";
import { fileURLToPath } from 'url';
import path from 'path';
import qs from 'qs';
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
        if (filename) {
            DocId = await postInvoiceData(from, mailBox);

            if(!DocId){
                throw new Error('No se pudo insertar el registro de la factura en la base de datos');
            }

            if(process.env.DEBUG){
                docPath = path.join(__dirname, 'temp', DocId.toString());
            }else{
                docPath = path.join(process.env.DOC_PATH, DocId.toString());
            }
            
            await mkdir(docPath, { recursive: true });
            const idDocPath = path.join(docPath, `DocOrigen.pdf`);
            await writeFile(idDocPath, attachment.content);

            const pathResult = await putInvoicePath(DocId, idDocPath);

            if(!pathResult){
                throw new Error('No se pudo actualizar la ruta de la factura en la base de datos');
            }

            const docBinary = await fileToBase64(idDocPath);

            return { Id: DocId, binary: docBinary, Ruta: idDocPath};
        }
    }catch(error){
        if(DocId != 0){
            deleteInvoice({ Id: DocId, Ruta: docPath });
        }
        throw error;
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

async function sendInvoiceAI(invoice, isRescan = false){
    try {
        let IdEmpotencyKey = `${Date.now()}-${invoice.Id}`;

        let data = new FormData();
        data.append('id', `${invoice.Id}`);
        data.append('file', fs.createReadStream(invoice.Ruta));
        data.append('webhook_url', `${process.env.WEBHOOK_URL}` ?? '');
        data.append('webhook_secret', '');
        data.append('metadata', JSON.stringify({
            "customer": { "name": invoice.customerName ?? '' },
            "supplier": { "name": invoice.supplierName ?? '' },
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
    updateJobResult
};