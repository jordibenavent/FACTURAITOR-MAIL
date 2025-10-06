import 'dotenv/config';
import sql from 'mssql';
const connect = sql.connect;
import fs from 'fs';
import { fileToBase64 } from './utilities.js';

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false, // true si usas Azure
    trustServerCertificate: true
  }
};

async function getConnection() {
  try {
    const pool = await connect(config);
    return pool;
  } catch (err) {
    console.error("Error conectando a SQL Server:", err);
    throw err;
  }
}

async function getAccounts(){
    try {
        
        const pool = await getConnection();
        const result = await pool
        .request()
        .query("select * from vPers_Buzones");

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function putInvoicePath(IdDoc, path){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('IdDoc', sql.Int, IdDoc)
        .input('Ruta', sql.VarChar(500), path)
        .query('update DocCabeceras set Ruta = @Ruta where IdDoc = @IdDoc');

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function putInvoiceData(from, mailBox){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('ProveedorEmail', sql.VarChar(150), from)
        .input('Buzon', sql.VarChar(150), mailBox)
        .output('IdDocOut', sql.Int)
        .execute('pPers_InsertaFactura');

        return result.output.IdDocOut;
    } catch (error) {
        console.log(error);
    }
}

async function getInvoiceData(IdDoc){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('IdDoc', sql.Int, IdDoc)
        .query('select IdDoc, Ruta from DocCabeceras where IdDoc = @IdDoc');

        const invoice = result.recordset[0];
        invoice.Ruta = invoice.Ruta.trim();

        const file = await fileToBase64(invoice.Ruta);

        if(!file){
            throw new Error('No se pudo leer el archivo de la factura');
        }

        return {
            IdDoc: invoice.IdDoc,
            binary: file
        };
    } catch (error) {
        console.log(error);
    }
}

async function deleteInvoiceData(IdDoc){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('IdDoc', sql.Int, IdDoc)
        .query('delete from DocCabeceras where IdDoc = @IdDoc');
    } catch (error) {
        console.log(error);
    }

}

export { sql, getAccounts ,getConnection, putInvoiceData, getInvoiceData, putInvoicePath, deleteInvoiceData };
