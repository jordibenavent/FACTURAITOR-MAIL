import express from 'express';
import { sendInvoiceAI, getJobResult, getJobStatus, updateJobResult } from '../../utilities.js';
import { getInvoiceData, getJobs, postJobData, putJobData } from '../../db.js';
import { startMailboxes } from '../../index.js';

const router = express.Router();

router.get('/restart-accounts', async (req, res) => {
        try {
            startMailboxes();
            res.status(200).json({ msg: 'Reiniciando buzones' });
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

router.get('/resend-invoice/:DocId', async (req, res) => {
    try {
        const { DocId } = req.params;

        const invoiceData = await getInvoiceData(DocId);
        
        if(!invoiceData){
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        
        const response = await sendInvoiceAI(invoiceData);

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

router.post('/job-reply', async (req, res) => {
    try {
        console.log('Nueva entrada en /job-reply');
        const { job_id, invoice_data, status } = req.body;

        if(!job_id || !invoice_data || !status){
            return res.status(400).json({ error: 'Se deben proporcionar los campos: job_id, invoice_data y status' });
        }

        const result = await putJobData(job_id, JSON.stringify(invoice_data), status);

        res.status(200).json({ resultado: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})


export { router }