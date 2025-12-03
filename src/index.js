import 'dotenv/config';
import Imap from 'imap';
import { getAccounts } from './db.js';
import { startApi } from './api/api.js';
import { 
    __dirname, 
    __filename, 
    createErrorMailBox, 
    fetchMails, 
    startFetchInterval,
    sendHealthCheckAI, 
} from './utilities.js';
import './logger-setup.js';
import { clearInterval } from 'timers';

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

                fetchInterval = startFetchInterval(imap, account);


            });
        } catch (error) {
            console.error('Error en la bandeja de entrada inbox:', error.message);
        }
    });

    imap.on('mail',async function () {
                    let apiHealth = await sendHealthCheckAI();

                    if(!apiHealth){
                        console.log('La IA ha devuelto un error de conexión. Se pospone el procesamiento de correos.');
                        return;
                    }

                    imap.seq.search(['UNSEEN'], async (err, results) => {
                            if (err) {
                                console.error('Error al buscar correos no leídos:', err.message);
                                return;
                            }


                            if (!results || results.length === 0) {
                                console.log('No hay nuevos correos');
                                return;
                            }

                            console.log('Nuevos correos detectados con el evento, procesando...');

                            const fetch = imap.seq.fetch(results, {
                                bodies: '',
                                struct: true,
                                markSeen: true
                            });
                            
                            await fetchMails(fetch, imap, account);

                            fetch.on('error', function (err) {
                                console.error('Error al buscar mensajes:', err.message);
                            });
                        })
    });

    imap.once('close', function (err) {
        console.log('Conexión IMAP cerrada: ', err);
        imap.removeAllListeners();

        let index = activeConnections.indexOf(imap);
        if (index > -1) {
            activeConnections.splice(index, 1);
        }

        if(fetchInterval){
            clearInterval(fetchInterval);
            fetchInterval = null;
        }

        reconnect();
    });

    imap.on("alert", (error) => console.log("IMAP alert:", error));

    imap.once('error', function (err) {
        console.error('Error en IMAP:', err);
    });

    imap.once('end', function () {
        console.log('Conexión IMAP terminada');
        
    });
    
    console.log("Listeners:", imap.listenerCount("mail"), imap.listenerCount("message"));

    imap.connect();
}



async function startMailboxes() {
    try { 
        
        const dbAccounts = await getAccounts();
        const accounts = dbAccounts.recordset;

        if(activeConnections.length > 0) {
            for(const mb of activeConnections) {
                console.log(`Cerrando conexión activa... `);
                mb.removeAllListeners();
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
                //Después de problemas y comerme la cabeza durante horas, esto da una sarta de problemas interesante. 
                //Al usar esta parte del objeto, lo estás configurando para que nunca se duerma(lo que podría parecer interesante desde un principio
                //ya que se supone que debería ayudar a que no se desconecte el servicio del host de mail, pues no, rompe el IDLE, un protocolo 
                //necesario para que los eventos funcionen y el host envíe las notificaciones)
                /*keepalive: {
                    interval: 300000,
                    idleInterval: 50000,
                    forceNoop: true
                },*/
                debug: (msg) => console.log(`[IMAP DEBUG] ${msg.trim()}`)
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