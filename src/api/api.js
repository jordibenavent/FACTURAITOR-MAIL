
import express from 'express';
import { router as v1Router } from './v1/v1.js';
import redoc from "redoc-express";
import swaggerJsdoc from "swagger-jsdoc";
import { __dirname }   from '../utilities.js';

const AIHost = 'http://44.198.229.9:8000';
const InvoicesEndpoint = '/v1/invoices';
const JobsEndpoint = '/v1/jobs';

function startApi(port = 5000) {
    const app = express();
    app.use(express.json());
    app.use('/v1', v1Router);
    
    app.get('/health', async (req, res) => {
        res.status(200).json({ status: 'ok', msg: 'API activa' });
    });

    app.listen(port, () => {
        console.log(`🚀 API escuchando en http://localhost:${port}`);
    });

}



export { startApi, AIHost, InvoicesEndpoint, JobsEndpoint };
