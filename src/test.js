import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import config from 'config';
import { fileURLToPath } from 'url';
import { sql, getConnection, getAccounts, putInvoiceData } from './db.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IdDoc = 1;

const docPath = path.join(__dirname, 'temp', IdDoc.toString());
console.log('Guardando archivo en:', docPath);
await fs.promises.mkdir(docPath, { recursive: true });
const idDocPath = path.join(docPath, `${IdDoc}.pdf`);