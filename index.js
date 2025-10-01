require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const config = require('config');

const accounts = config.get('accounts');

async function processAttachment (attachment) {
    try{
        const filename = attachment.filename;
        if (filename) {
            const tempPath = path.join(__dirname, 'tmp_' + Date.now() + '.pdf');
            await fs.promises.writeFile(tempPath, attachment.content);

            let data = new FormData();
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
                });
        }
    }catch(error){
        console.error('Error procesando adjunto:', attachment.filename);
        console.error('Error:', error.message);
        return;
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
                                msg.on('body', function (stream) {
                                    simpleParser(stream, async (err, parsed) => {
                                        if (err) {
                                            console.error('Error parseando mensaje:', err.message);
                                            return;
                                        }

                                        if (parsed.attachments && parsed.attachments.length > 0) {
                                            parsed.attachments.forEach( (x) => {
                                                if(x.contentType === 'application/pdf') {
                                                    console.log('Adjunto PDF encontrado:', x.filename);
                                                    processAttachment(x).catch(err => {
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


for(const account of accounts) {
    console.log(`Conectando a ${account.user}...`);
    prepareBox(account);
    console.log('Conectado a ' + account.user);
}