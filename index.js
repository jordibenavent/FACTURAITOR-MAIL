require('dotenv').config();
const Imap = require('imap');
const { simpleParser } = require('mailparser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data'); // npm install --save form-data

const imap = new Imap({
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST,
    port: process.env.IMAP_PORT,
    tls: true
});

function openInbox(box ,cb) {
                //Abre la bandeja con el nombre entre las comillas, se ejecuta la funcion CB cuando se abre la bandeja
    imap.openBox(box, false, cb);
}

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

imap.once('ready', function () {
    try {
        openInbox('INBOX', function (err, box) {
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
});

imap.connect();
