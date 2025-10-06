import fs from 'fs/promises';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { deleteInvoiceData, getInvoiceData, putInvoicePath, putInvoiceData } from './db.js';
import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';

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
        if (invoice.Path != '') {
            await fs.rm(invoice.Path, { recursive: true, force: true });
        }
    } catch (error) {
        console.log(error);
    }

}


async function processAttachment (attachment, from, mailBox) {
    let IdDoc = 0;
    let docPath = '';
    try{
        const filename = attachment.filename;
        if (filename) {
            IdDoc = await putInvoiceData(from, mailBox);

            if(IdDoc == 0){
                throw new Error('No se pudo insertar el registro de la factura en la base de datos');
            }

            docPath = path.join(__dirname, 'temp', IdDoc.toString());
            await mkdir(docPath, { recursive: true });
            const idDocPath = path.join(docPath, `${IdDoc}.pdf`);
            await writeFile(idDocPath, attachment.content);

            await putInvoicePath(IdDoc, idDocPath);

            const docBinary = await fileToBase64(idDocPath);

            return { Id: IdDoc, binary: docBinary, Path: idDocPath};
        }
    }catch(error){
        if(IdDoc != 0){
            deleteInvoice({ Id: IdDoc, Path: docPath });
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
                    console.log('Error marcando como no leído:', err.message);
                } else {
                    console.log('Correo marcado como leído');
                }
            });
        }
    } catch (error) {
        console.log(error);
    }
}

async function sendInvoiceAI(invoice){
    try {
        let data = new FormData();
        data.append('', fs.createReadStream(tempPath));

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: process.env.API + process.env.API_ENDPOINT,
            headers: { 
                'content-type': 'application/pdf',
                ...data.getHeaders()
                },
            data : data
        };

        const response = await axios.request(config);

        return response.data;
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
    markSeen 
};