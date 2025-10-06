import express from 'express';
import { sendInvoiceAI } from '../../utilities.js';
import { getInvoiceData } from '../../db.js';
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

router.get('/resend-invoice/:IdDoc', async (req, res) => {
    try {
        const { IdDoc } = req.params;

        const invoiceData = await getInvoiceData(IdDoc);
        
        if(!invoiceData){
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        
        const response = await sendInvoiceAI(invoiceData);

        return res.status(200).json({ msg: 'Factura reenviada correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reply-job', async (req, res) => {
    try {
        const { JobId, Response } = req.body;

        if(!JobId || !Response){
            return res.status(400).json({ error: 'Se deben proporcionar ambos campos: JobId, Response' });
        }
        


        res.status(200)
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
})


export { router }