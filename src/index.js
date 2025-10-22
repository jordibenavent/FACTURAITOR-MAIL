import 'dotenv/config';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import fs from 'fs';
import path from 'path';
import { getAccounts, postJobData, getInvoiceData } from './db.js';
import { startApi } from './api/api.js';
import { deleteInvoice, __dirname, __filename, processAttachment, sendInvoiceAI, createErrorMailBox, markSeen, moveToErrorBox, fetchMails, startFetchInterval
 } from './utilities.js';
import './logger-setup.js';
import { clearInterval } from 'timers';
import { start } from 'repl';

const activeConnections = [];

function prepareBox(account){
    const imap = new Imap(account);
    activeConnections.push(imap);
    
    const reconnect = () => {
        console.log(`Reconectando a ${account.user} en 10 segundos...`);
        setTimeout(() => prepareBox(account), 10000);
    };

    let fetchInterval = null;

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
                            
                            fetchMails(fetch, imap, account);

                            fetch.on('error', function (err) {
                                console.error('Error al buscar mensajes:', err.message);
                            });
                        })
                    });
                });

                fetchInterval = startFetchInterval(imap, account);

            });
        } catch (error) {
            console.error('Error en la bandeja de entrada inbox:', error.message);
        }
    });

    imap.once('close', function (err) {
        console.log('Conexión IMAP cerrada: ', err);
        imap.end();
    });

    imap.on("alert", (error) => console.log("IMAP alert:", error));

    imap.once('error', function (err) {
        console.error('Error en IMAP:', err);
        imap.end();
    });

    imap.once('end', function () {
        console.log('Conexión IMAP terminada');

        if(fetchInterval){
            clearInterval(fetchInterval);
            fetchInterval = null;
        }

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
                password: account.Password,
                host: account.Host,
                port: account.Port,
                tls: account.TLS,
                tlsOptions: { rejectUnauthorized: false },
                debug: (msg) => {
                    if (
                        msg.toLowerCase().includes("bad") ||
                        msg.toLowerCase().includes("no ") || 
                        msg.toLowerCase().includes("error") ||
                        msg.toLowerCase().includes("fail") ||
                        msg.toLowerCase().includes("disconnect")
                    ) {
                        console.log(`[IMAP DEBUG] ${msg.trim()}`);
                    }
                }
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