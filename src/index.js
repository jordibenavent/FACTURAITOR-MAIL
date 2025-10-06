import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { sql, getConnection, getAccounts, putInvoiceData, putInvoicePath, deleteInvoiceData } from './db.js';
import { startApi } from './api/api.js';
import { deleteInvoice, __dirname, __filename, processAttachment, sendInvoiceAI, createErrorMailBox, markSeen, moveToErrorBox } from './utilities.js';

const activeConnections = [];

function prepareBox(account){
    const imap = new Imap(account);
    activeConnections.push(imap);
    
    const reconnect = () => {
        console.log(`Reconectando a ${account.user} en 10 segundos...`);
        setTimeout(() => prepareBox(account), 10000);
    };

    imap.once('ready', function () {
        try {
            createErrorMailBox(imap);

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
                                markSeen: false
                            });
                            
                            fetch.on('message', function (msg) {
                                let msgUid;

                                msg.on('attributes', function (attrs) {
                                    msgUid = attrs.uid;
                                });

                                msg.on('body', function (stream) {
                                    simpleParser(stream, async (err, parsed) => {
                                        if (err) {
                                            
                                            moveToErrorBox(imap, msgUid);

                                            console.error('Error parseando mensaje:', err.message);
                                            return;
                                        }

                                        if (parsed.attachments && parsed.attachments.length > 0) {
                                            const inserted = [];
                                            let errored = false;
                                            parsed.attachments.forEach( (x) => {
                                                if(x.contentType === 'application/pdf') {
                                                    console.log('Adjunto PDF encontrado:', x.filename);

                                                    const invoice = processAttachment(x, parsed.from.value[0].address, account.user).catch(err => {
                                                        console.error('Error procesando adjunto:', err.message);
                                                        errored = true;
                                                    });

                                                    inserted.push(invoice);
                                                }
                                                
                                            });

                                            if(errored){
                                                for(const insertedInvoice of inserted){
                                                    
                                                    deleteInvoice(insertedInvoice);
                                                    
                                                }
                                                moveToErrorBox(imap, msgUid);
                                                console.log('Algún adjunto ha fallado, se ha desmarcado el correo como no leído para reintentar más tarde');
                                                
                                            }else{
                                                markSeen(imap, msgUid);
                                                for(const insertedInvoice of inserted){
                                                    //await sendInvoiceAI(insertedInvoice);
                                                }
                                            }
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


async function startMailboxes() {
    try { 
        const dbAccounts = await getAccounts();
        const accounts = dbAccounts.recordset;
        
        if(activeConnections.length > 0) {
            for(const mb of activeConnections) {
                console.log(`Cerrando conexión activa... `);
                mb.removeAllListeners('end');
                mb.end();
            }
            activeConnections.length = 0;
        }
        
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
}

try {
    startMailboxes();
    startApi();
} catch (error) {
    console.log('Error iniciando app:', error.message);
}

export { startMailboxes };