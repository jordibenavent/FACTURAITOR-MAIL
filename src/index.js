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

async function processAttachment (attachment, from, mailBox) {
    try{
        const filename = attachment.filename;
        if (filename) {
            const IdDoc = await putInvoiceData(from, mailBox);

            const docPath = path.join(__dirname, 'temp', IdDoc.toString());
            await fs.promises.mkdir(docPath, { recursive: true });
            const idDocPath = path.join(docPath, `${IdDoc}.pdf`);
            await fs.promises.writeFile(idDocPath, attachment.content);

            /*let data = new FormData();
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

            axios.request(config)
                .then((response) => {
                    console.log(JSON.stringify(response.data));
                })
                .catch((error) => {
                    console.log(error.message)
                });*/
        }
    }catch(error){
        console.error('Error procesando adjunto:', attachment.filename);
        console.error('Error:', error.message);
    }
}

function prepareBox(account){
    const imap = new Imap(account);

    const reconnect = () => {
        console.log(`Reconectando a ${account.user} en 10 segundos...`);
        setTimeout(() => prepareBox(account), 10000);
    };

    imap.once('ready', function () {
        try {
            imap.openBox('INBOX', false, function (err, box) {
                if (err) throw err;

                imap.on('mail', function () {
                    console.log('Nuevos correos detectados, procesando...');
                    
                    imap.openBox('INBOX', false, function (err, box) {
                        if (err) throw err;

                        imap.seq.search(['UNSEEN'], (err, results) => {
                            if (err) {
                                console.error('Error al buscar correos no leídos:', err.message);
                                return;
                            }

                            if (!results || results.length === 0) {
                                console.log('No hay nuevos correos');
                                return;
                            }

                            const fetch = imap.seq.fetch(results, {
                                bodies: '',
                                struct: true,
                                markSeen: true
                            });

                            fetch.on('message', function (msg) {
                                let msgUid;

                                msg.on('attributes', function (attrs) {
                                    msgUid = attrs.uid;
                                });

                                msg.on('body', function (stream) {
                                    simpleParser(stream, async (err, parsed) => {
                                        if (err) {
                                            
                                            if (msgUid) {
                                                imap.delFlags(msgUid, '\\Seen', (err) => {
                                                    if (err) console.log('Error desmarcando como no leído:', err.message);
                                                });
                                            }

                                            console.error('Error parseando mensaje:', err.message);
                                            return;
                                        }

                                        if (parsed.attachments && parsed.attachments.length > 0) {
                                            parsed.attachments.forEach( (x) => {
                                                if(x.contentType === 'application/pdf') {
                                                    console.log('Adjunto PDF encontrado:', x.filename);
                                                    //TODO RECOGER LOS ID POR SI HUBIESEN VARIOS ADJUNTOS Y FALLASE DESPUÉS DE HABERSE
                                                    //PROCESADO ALGUNO REVERTIR LOS CAMBIOS Y MARCAR EL CORREO COMO NO LEIDO
                                                    processAttachment(x, parsed.from.value[0].address, account.user).catch(err => {
                                                        console.error('Error procesando adjunto:', err.message);
                                                    });
                                                }
                                            });
                                        }
                                    });
                                });
                            });

                            fetch.on('error', function (err) {
                                console.error('Error al buscar mensajes:', err.message);
                            });
                        })
                    });
                });
            });
        } catch (error) {
            console.error('Error en la bandeja de entrada inbox:', error.message);
        }
    });

    imap.once('error', function (err) {
        console.error('Error en IMAP:', err.message);
    });

    imap.once('end', function () {
        console.log('Conexión IMAP terminada');
        reconnect();
    });

    imap.connect();
}


try { 
    const dbAccounts = await getAccounts();
    const accounts = dbAccounts.recordset;
    
    for(const account of accounts) {
        console.log(`Conectando a ${account.Email}...`);
        const imapAccount = {
            user: account.Email,
            password: account.password,
            host: account.host,
            port: account.port,
            tls: account.tls
        }
        prepareBox(imapAccount);
        console.log('Conectado a ' + account.Email);
    }
} catch (error) {
    console.log('Error obteniendo cuentas de la base de datos:', error.message);    
}
