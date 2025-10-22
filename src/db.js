import 'dotenv/config';
import sql from 'mssql';
const connect = sql.connect;
import fs, { stat } from 'fs';

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
        .query("select * from Cuentas");

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function putInvoicePath(DocId, path){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('DocId', sql.Int, DocId)
        .input('Ruta', sql.VarChar(500), path)
        .query('update DocCabeceras set Ruta = @Ruta where DocId = @DocId');

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function postInvoiceData(from, mailBox){
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

async function putInvoiceClaveId(DocId, ClaveId){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('DocId', sql.Int, DocId)
        .input('ClaveId', sql.VarChar(250), ClaveId)
        .query('update DocCabeceras set ClaveId = @ClaveId where DocId = @DocId');
        return result;
    } catch (error) {
        console.log(error);
    }
}

async function getInvoiceData(DocId){
    try {
        let supplier = '';
        let client = '';
        let invoiceType = 'creditor';

        const pool = await getConnection();
        const result = await pool
        .request()
        .input('DocId', sql.Int, DocId)
        .query('select DocId, Ruta, ProveedorEmail, EmailBox from DocCabeceras where DocId = @DocId');

        const invoice = result.recordset[0];
        invoice.Ruta = invoice.Ruta.trim();

        const customer = await pool.request()
        .input('Email', sql.VarChar(150), invoice.EmailBox)
        .query('select EmpNombre, ProyectoGestion from Empresas where EmpEmail = @Email');

        const proveedor = await pool.request()
        .input('E_mail', sql.VarChar(150), invoice.ProveedorEmail)
        .query('select TOP 1 Proveedor, FacturasAcreedor from ProvDatos where E_Mail = @E_mail order by IdProveedor Desc');

        //TODO leer archivo de la ruta para ver si no está vacío y no enviar algo que de error y evite fallos

        if(proveedor.recordset.length > 0){
            console.log(proveedor.recordset[0].FacturasAcreedor);
            switch(proveedor.recordset[0].FacturasAcreedor){
                case 1:
                    invoiceType =  'creditor';
                    break;
                case 0:
                    invoiceType = 'supplier';
                    break;
            }
        }

        return {
            Id: invoice.DocId,
            Ruta: invoice.Ruta,
            CustomerName: customer.recordset.length > 0 ? customer.recordset[0].EmpNombre.trim() : '',
            SupplierName: proveedor.recordset.length > 0 ? proveedor.recordset[0].Proveedor.trim() : '',
            handlesProjects: customer.recordset.length > 0 ? customer.recordset[0].ProyectoGestion : false,
            type: invoiceType
        };
    } catch (error) {
        console.log(error);
    }
}

async function deleteInvoiceData(DocId){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('DocId', sql.Int, DocId)
        .query('delete from DocCabeceras where DocId = @DocId');
    } catch (error) {
        console.log(error);
    }

}

async function getJobs(){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .query("select * from DocAI where Estado = 1");
        
        return result;
    } catch (error) {
        console.log(error);
    }
}

async function postJobData(JobId, IdEmpotencyKey, Status, DocId){
    try {
        if(!JobId || !Status || !DocId){
            throw new Error('JobId, Status y DocId es obligatorio');
        }

        switch(Status){
            case 'PENDING':
                Status = 1
                break;
            case 'SUCCEEDED':
                Status = 2
                break;
        }

        const pool = await getConnection();
        const result = await pool
        .request()
        .input('JobId', sql.VarChar(sql.MAX), JobId)
        .input('ClaveId', sql.VarChar(250), IdEmpotencyKey)
        .input('Estado', sql.Int, Status)
        .input('DocId', sql.Int, DocId)
        .query(`INSERT INTO DocAI (Id, JobId, DocId, ClaveId, Estado) values (@DocId, @JobId, @DocId, @ClaveId, @Estado)`);

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function putJobData(JobId, JSON, Status){
    try {
        if(!JobId || !Status){
            throw new Error('JobId y Status es obligatorio');
        }
        if(!JSON){
            JSON = '';
        }

        switch(Status){
            case 'PENDING':
                Status = 1
                break;
            case 'SUCCEEDED':
                Status = 2
                break;
        }

        if(Status != 1 && Status != 2){
            throw new Error('Status no válido');
        }

        const pool = await getConnection();
        const result = await pool
        .request()
        .input('JobId', sql.VarChar(sql.MAX), JobId)
        .input('DocJson', sql.VarChar(sql.MAX), JSON)
        .input('Estado', sql.Int, Status)
        .query(`UPDATE DocAI Set Estado = @Estado, DocJson = @DocJson where JobId = @JobId and Estado = 1`);

        return result;
    } catch (error) {
        console.log(error);
    }
}

export { 
    sql, 
    getAccounts,
    getConnection, 
    postInvoiceData, 
    getInvoiceData, 
    putInvoicePath, 
    deleteInvoiceData, 
    postJobData, 
    putJobData,
    getJobs,
    putInvoiceClaveId
};
