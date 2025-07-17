const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.post('/send-pdf', async (req, res) => {
    try{

        console.log('PDF recibido desde el bot');
        const tempPath = path.join(__dirname, 'server_tmp_' + Date.now() + '.pdf');
        const writeStream = fs.createWriteStream(tempPath);

        req.pipe(writeStream);
        res.send('✅ PDF recibido correctamente');
    }catch(err){
        console.error('Error al recibir PDF:', err.message);
        res.status(500).send('Error al procesar el PDF');
    }
})

app.get('/health', (req, res) => {
    res.send('Servidor en funcionamiento');
});

app.listen(3000, () => {
    console.log('Servidor escuchando en el puerto 3000');
})