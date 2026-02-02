import express from 'express';
import 'dotenv/config';
import { sendInvoiceAI, getJobResult, getJobStatus, updateJobResult, createInvoice, isDomainAuthorized, readFileBuffer } from '../../utilities.js';
import { getInvoiceData, getJobs, postInvoiceData, postJobData, putInvoicePath, putJobData, wipeInvoiceData, getAuthorizedDomains, postTempProveedorData, getLicense } from '../../db.js';
import { startMailboxes } from '../../index.js';

const router = express.Router();

router.get('/restart-accounts', async (req, res) => {
        try {
            
            const isAuthorized = await checkAuthorityAPI();

            if(!isAuthorized){
                return res.status(403).json({ error: 'Licencia inválida' });
            }

            console.log('Reiniciando las cuentas de correo')
            startMailboxes(true);
            res.status(200).json({ msg: 'Se están reiniciando los buzones' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
});

router.get('/job-status', async (req, res) => {
    try {
        await updateJobResult();

        return res.status(200).json({ msg: 'Jobs procesados' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})

router.post('/recreate-invoices', async (req, res) => {
    try {
        const DocIds = req.body;

        const responses = [];

        for(const DocIdObject of DocIds){
            const DocId = DocIdObject.DocId;
            console.log('Volviendo a crear la factura con DocId: ' + DocId);

            const invoiceData = await getInvoiceData(DocId);

            const Invoice = {
                DocId: invoiceData.DocId,
                ResponseAI: null
            }

            invoiceData.DocId = DocId;
            
            if(!invoiceData){
                console.log('Factura no encontrada con DocId: ' + DocId);
                Invoice.Error = 'INVOICE_NOT_FOUND';
                responses.push(Invoice);
                continue;
            }

            const isAuthorized = await isDomainAuthorized(invoiceData.From);

            if(!isAuthorized){
                console.log('Dominio no autorizado: ' + invoiceData.From);
                return res.status(403).json({ error: 'Dominio del remitente no autorizado' });
            }
            
            const file = await readFileBuffer(invoiceData.Ruta);

            if(!file){
                Invoice.Error = 'READFILE_ERROR';
                console.log('Error al leer el archivo de la factura con DocId: ' + DocId);
                responses.push(Invoice);
                continue;
            }

            const wipeResult = await wipeInvoiceData(invoiceData);

            if(!wipeResult){
                Invoice.Error = 'WIPEINVOICEDATA_ERROR';
                console.log('Error al wipear los datos de la factura con DocId: ' + DocId);
                responses.push(Invoice);
                continue;
            }

            const createResult = await createInvoice({
                From: invoiceData.From, 
                MailBox: invoiceData.MailBox, 
                SituacionEspecial: null
            }, file);

            if(!createResult.DocId){
                Invoice.Error = 'POSTINVOICEDATA_ERROR';
                responses.push(Invoice);
                continue;
            }

            invoiceData.DocId = createResult.DocId;
            invoiceData.Ruta = createResult.Ruta;

            const responseAI = await sendInvoiceAI(invoiceData, false);
            Invoice.ResponseAI = responseAI;
            Invoice.DocId = invoiceData.DocId;

            responses.push(Invoice);

            //Inserta en tabla temporal un registro para que luego en flexy un cron job lea los datos de la IA y cree el proveedor si no existe.
            //Esto solo se hace cuando no existía el dominio autorizado previamente.
            postTempProveedorData(invoiceData.DocId, invoiceData.From.split('@')[1]);
        }

        return res.status(200).json({ responses });
    } catch (err) {
        console.log(err)
        res.status(500).json({ error: err.message });
    }
});

//Por ahora esta API no se usa.
router.get('/resend-invoice/:DocId', async (req, res) => {
    try {
        const { DocId } = req.params;

        const invoiceData = await getInvoiceData(DocId);
        
        if(!invoiceData){
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        
        const response = await sendInvoiceAI(invoiceData, true);

        const JobId = response.Data.JobId;
        const Json = response.Data.Json;
        const Status = response.Data.Status;
        const IdEmpotencyKey = response.IdEmpotencyKey;
        

        const result = await postJobData(JobId, Json, IdEmpotencyKey, Status, DocId);

        return res.status(200).json({ msg: 'Factura reenviada correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//Punto de entrada de lo que devuelve la IA
router.post('/job-reply', async (req, res) => {
    try {
        console.log('Nueva entrada en /job-reply');

        const job_id = req.body.job_id;
        const status = req.body.status;

        if(!job_id || !status){
            return res.status(400).json({ error: 'Se deben proporcionar los campos: job_id, invoice_data y status' });//TO DO: Actualizar el job id y poner status error IA
        }

        const result = await putJobData(job_id, req.body, status);

        res.status(200).json({ resultado: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})


export { router }