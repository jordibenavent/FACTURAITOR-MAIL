import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { getAccounts, postJobData, getInvoiceData } from './db.js';
import { startApi } from './api/api.js';
import { deleteInvoice, __dirname, __filename, processAttachment, sendInvoiceAI, createErrorMailBox, markSeen, moveToErrorBox } from './utilities.js';
import './logger-setup.js';

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
                            
                            fetch.on('message', function (msg, seqno) {
                                //let msgUid;

                                /*msg.on('attributes', function (attrs) {
                                    msgUid = attrs.uid;
                                });*/

                                msg.on('body', function (stream) {
                                    simpleParser(stream, async (err, parsed) => {
                                        if (err) {
                                            
                                            moveToErrorBox(imap, seqno);

                                            console.error('Error parseando mensaje:', err.message);
                                            return;
                                        }

                                        if (parsed.attachments && parsed.attachments.length > 0) {
                                            const inserted = [];
                                            let errored = false;

                                            const pdfs = parsed.attachments.filter(x => x.contentType === 'application/pdf');
                                            
                                            for(const pdf of pdfs){
                                                const invoice = await processAttachment(pdf, parsed.from.value[0].address, account.user)
                                                                    .catch(err => {
                                                                            console.error('Error procesando adjunto:', err.message);
                                                                            errored = true;
                                                                        });

                                                if(invoice && invoice.Id){
                                                    inserted.push(invoice);   
                                                }
                                            }

                                            if(errored){
                                                removeInsertedInvoices(inserted);
                                                moveToErrorBox(imap, seqno);
                                            }else{
                                                let result = []
                                                
                                                for(const insertedInvoice of inserted){
                                                    const data = await getInvoiceData(insertedInvoice.Id);

                                                    if(!data){
                                                        result.push(false);
                                                    }else{
                                                        result.push(await sendInvoiceAI(data))
                                                    }
                                                    
                                                }

                                                if(result.filter(x => x == false).length > 0){
                                                    removeInsertedInvoices(inserted);
                                                    moveToErrorBox(imap, seqno);
                                                    console.log('Error enviando factura a Facturaitor o actualizando la base de datos');
                                                }

                                                markSeen(imap, seqno);
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
        console.error('Error en IMAP:', err);
    });

    imap.once('end', function () {
        console.log('Conexión IMAP terminada');
        reconnect();
    });
    
    imap.connect();
}

function removeInsertedInvoices(inserted){
    try {
        for(const insertedInvoice of inserted){
            deleteInvoice(insertedInvoice);
        }
    } catch (error) {
        console.log(error);
    }
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
                password: account.Password,
                host: account.Host,
                port: account.Port,
                tls: account.TLS,
                tlsOptions: { rejectUnauthorized: false }
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