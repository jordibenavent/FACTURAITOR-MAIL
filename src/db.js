import 'dotenv/config';
import sql from 'mssql';
const connect = sql.connect;

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

export { sql, getAccounts ,getConnection, putInvoiceData };
