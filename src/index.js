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
let isManuallyRestarting = false;

function prepareBox(account){
    const imap = new Imap(account);
    activeConnections.push(imap);
    
    //Vuelve a montar el buzón
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

                // Inicia el intervalo de fetch para revisar nuevos correos periódicamente
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

    // Este es el evento que se dispara cuando la conexión IMAP se cierra del TODO(el último que se ejecuta)
    imap.once('close', function (err) {
        console.log('Conexión IMAP cerrada: ', err);

        // Elimina los listeners para evitar múltiples reconexiones
        imap.removeAllListeners();

        if(fetchInterval != null){
            clearInterval(fetchInterval);
            fetchInterval = null;
        }

        if(!isManuallyRestarting){
            console.log('Estado IMAP:' + imap.state);
            console.log('No es desconexión manual, reconectando...');
            reconnect();
        }
    });

    imap.on("alert", (error) => console.log("IMAP alert:", error));

    imap.once('error', function (err) {
        console.error('Error en IMAP:', err);
    });

    imap.once('end', function () {
        console.log('Conexión IMAP terminada');
        
    });

    imap.connect();
}



async function startMailboxes(manualRestart = false) {
    try { 
        //Evitamos que se instancien 2 listeners de correo si se está haciendo un reinicio manual
        isManuallyRestarting = manualRestart;

        const dbAccounts = await getAccounts();
        const accounts = dbAccounts.recordset;

        if(activeConnections.length > 0) {
            for(const mb of activeConnections) {
                if(mb.state != 'disconnected'){

                    console.log(`Cerrando conexión activa... `);
                    console.log('Estado antes de cerrar:' + mb.state);
                    console.log('Cerrando bandeja de ' + mb._config.user);

                    // Termina la conexión IMAP
                    mb.end();

                    console.log('Estado despues de cerrar:' + mb.state);
                    
                    // Espera hasta que la conexión IMAP esté completamente cerrada
                    // Evita errores al intentar reconectar demasiado rápido
                    while(mb.state == 'authenticated' || mb.state == 'connecting' || mb.state == 'connected') {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log('El estado sigue siendo activo, esperando a que se cierre...' + mb.state);
                    }
                }
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
                //Al usar esta parte del objeto, lo estás configurando para que nunca se duerma(lo que podría parecer interesante desde un principio
                //ya que se supone que debería ayudar a que no se desconecte el servicio del host de mail, pues no, rompe el IDLE, un protocolo 
                //necesario para que los eventos funcionen y el host envíe las notificaciones a la APP)
                /*keepalive: {
                    interval: 300000,
                    idleInterval: 50000,
                    forceNoop: true
                },*/
                //debug: (msg) => console.log(`[IMAP DEBUG] ${msg.trim()}`) //ESTO SE DESCOMENTA SI QUIERES DEBUGAR TODO LO QUE TIENE QUE VER CON EL SERVICIO IMAP
            }

            prepareBox(imapAccount);

            console.log('Conectado a ' + account.Email);
        }

        isManuallyRestarting = false;
    } catch (error) {
        console.log('Error obteniendo cuentas de la base de datos:', error.message);
    }
}



try {
    startMailboxes();
    startApi(process.env.APP_PUERTO);
} catch (error) {
    console.log('Error iniciando app:', error.message);
}



export { startMailboxes };