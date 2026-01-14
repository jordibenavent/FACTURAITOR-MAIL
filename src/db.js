import 'dotenv/config';
import sql from 'mssql';
const connect = sql.connect;
import fs, { stat } from 'fs';
import * as fsp from 'fs/promises';

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

const configIC = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.CONFIG_DB_NAME,
  options: {
    encrypt: false, // true si usas Azure
    trustServerCertificate: true
  }
};

let license = {
    Id: null,
    Expiry: null
}

let poolPromiseData =  null;
let poolPromiseConfig = null;

async function sqlConnectData(){
    poolPromiseData = new sql.ConnectionPool(config)
                            .connect()
                            .then(pool => {
                                return pool;
                            })
                            .catch(err => {
                                console.error('Error conectando a SQL Server Data:', err);
                                throw err;
                            });
}

async function sqlConnectConfig(){
    poolPromiseConfig = new sql.ConnectionPool(configIC)
                            .connect()
                            .then(pool => {
                                return pool;
                            })
                            .catch(err => {
                                console.error('Error conectando a SQL Server Config:', err);
                                throw err;
                            });
}

async function getConnection(database = 'data') {
  try {
    switch(database){
        case 'data':
            if(!poolPromiseData){
                await sqlConnectData();
            }
            return poolPromiseData;
        case 'config':
            if(!poolPromiseConfig){
                await sqlConnectConfig();
            }
            return poolPromiseConfig;
        default:
            throw new Error('Base de datos no válida');
    }
  } catch (err) {
    console.error("Error al obtener la conexión a SQL:", err);
    throw err;
  }
}

async function getLicense(){
    try {
        if(license.Expiry == null || license.Id < new Date()){
            let LicenseId = await getLicenseId();

            if(LicenseId != null && LicenseId != ''){
                license.Id = LicenseId;
            }
            
            let date = new Date();
            date = date.setDate(date.getDate() + 1);
            license.Expiry = date;
        }
        
        return license.Id;
    } catch (error) {
        console.log(error);
    }
}

async function getLicenseId(){
    try {
        const pool = await getConnection('config');
            const result = await pool
            .request()
            .query("select TOP 1 LicenseId from FacturAItorBD.dbo.License");

        return result.recordset[0].LicenseId;
    } catch (error) {
        console.log(error);
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

async function postInvoiceData(from, mailBox, situacionEspecial){
    try {
        const pool = await getConnection();
        const result = await pool
        .request()
        .input('ProveedorEmail', sql.VarChar(150), from)
        .input('Buzon', sql.VarChar(150), mailBox)
        .input('SituacionEspecial', sql.Int, situacionEspecial)
        .output('IdDocOut', sql.Int)
        .execute('pPers_InsertaFactura');

        console.log('Se ha insertado la cabecera: ' + result.output.IdDocOut)

        if(!result?.output?.IdDocOut){
            return null;
        }

        return result.output.IdDocOut;
    } catch (error) {
        console.log(error);
        return null;
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

async function wipeInvoiceData(invoice){
    try {
        if (invoice.Ruta != '') {
            await fsp.rm(invoice.Ruta, { recursive: true, force: true });
        }

        const pool = await getConnection();
        const result = await pool
        .request()
        .input('DocId', sql.Int, invoice.DocId)
        .query('delete from DocCabeceras where DocId = @DocId');

        const resultDocAI = await pool
        .request()
        .input('DocId', sql.Int, invoice.DocId)
        .query('delete from DocAI where DocId = @DocId');

        if(result.rowsAffected[0] == 0){
            return false;
        }

        return true;
    } catch (error) {
        console.log(error);
        return false;
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
        .query('select DocId, Ruta, ProveedorEmail, EmailBox, SituacionEspecial from DocCabeceras where DocId = @DocId');

        const invoice = result.recordset[0];
        invoice.Ruta = invoice.Ruta.trim();


        const customer = await pool.request()
        .input('Email', sql.VarChar(150), invoice.EmailBox)
        .query('select top 1 EmpNombre, EmpNif, ProyectoGestion from Empresas where EmpEmail = @Email');

        const proveedor = await pool.request()
        .input('E_mail', sql.VarChar(150), invoice.ProveedorEmail)
        .query('select TOP 1 Proveedor, Nif, FacturasAcreedor from ProvDatos where E_Mail = @E_mail order by IdProveedor Desc');

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
            DocId: invoice.DocId,
            Ruta: invoice.Ruta,
            From: invoice.ProveedorEmail,
            MailBox: invoice.EmailBox,
            SituacionEspecial: invoice.SituacionEspecial,
            CustomerName: customer.recordset.length > 0 ? customer.recordset[0].EmpNombre.trim() : '',
            SupplierName: proveedor.recordset.length > 0 ? proveedor.recordset[0].Proveedor.trim() : '',
            CustomerNif: customer.recordset.length > 0 ? customer.recordset[0].EmpNif.trim() : '',
            SupplierNif: proveedor.recordset.length > 0 ? proveedor.recordset[0].Nif.trim() : '',
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

async function putJobData(JobId, Body, Status){
    try {
        if(!JobId || !Status){
            throw new Error('JobId y Status es obligatorio');
        }
        
        if(!Body){
            Body = '';
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
        .input('DocJson', sql.VarChar(sql.MAX), JSON.stringify(Body))
        .input('Estado', sql.Int, Status)
        .input('Procesado', sql.DateTime2, Body.processed_at ?? null)
        .input('Status', sql.Int, Status ?? null)
        .input('Complexity', sql.VarChar(sql.MAX), Body.complexity ?? null)
        .input('Bytes', sql.BigInt(), Body.metrics.file_size_bytes ?? null)
        .input('TiempoProcesadoMS', sql.BigInt(), Body.metrics.estimated_processing_time_ms ?? null)
        .input('TipoContenido', sql.VarChar(sql.MAX), Body.metrics.content_type ?? null)
        .input('Fiabilidad', sql.Float, Body.confidence ?? null)
        .input('CodigoErrorIA', sql.VarChar(sql.MAX), Body.error != null ? Body.error.code ?? null : null)
        .input('MensajeErrorIA', sql.VarChar(sql.MAX), Body.error != null ? Body.error.message ?? null : null)
        .input('Tokens', sql.BigInt(), Body.token_usage.total_tokens ?? null)
        .input('PromptTokens', sql.BigInt(), Body.token_usage.prompt_tokens ?? null)
        .input('FinalizadoTokens', sql.BigInt(), Body.token_usage.completion_tokens ?? null)
        .query(`UPDATE DocAI Set Estado = @Estado, DocJson = @DocJson, Procesado = @Procesado, Status = @Status, Complexity = @Complexity,
             Bytes = @Bytes, TiempoProcesadoMS = @TiempoProcesadoMS, TipoContenido = @TipoContenido, Fiabilidad = @Fiabilidad, CodigoErrorIA = @CodigoErrorIA, 
             MensajeErrorIA = @MensajeErrorIA, Tokens = @Tokens, PromptTokens = @PromptTokens, FinalizadoTokens = @FinalizadoTokens
             where JobId = @JobId and Estado = 1`);

        return result;
    } catch (error) {
        console.log(error);
    }
}

async function getAuthorizedDomains(){
    try {
        const pool = await getConnection();
        const result = await pool
            .request()
            .query(`select CIF, Dominio from RemitentesAutorizados`);

        
        return result.recordset;
    } catch (error) {
        console.log(error)
    }
}

async function getPermitedExtensions(){
    try {
        const pool = await getConnection();
        const result = await pool
            .request()
            .query(`select TipoArchivo, MaxKilobyte from FicherosPermitidos`);

        return result.recordset;
    } catch (error) {
        console.log(error)
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
    putInvoiceClaveId, 
    getAuthorizedDomains,
    getPermitedExtensions,
    wipeInvoiceData,
    getLicense
};
