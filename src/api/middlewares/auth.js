import { getLicense } from '../../db.js';

async function authMiddleware(req, res, next) {
    try {
        const license = await getLicense();
        const licenseKey = req.headers.license;

        console.log('License Key recibida: ' + licenseKey);
        console.log('License Key en DB: ' + license);

        if (license != null && licenseKey == license) {
            next();
            return;
        }

        return res.status(401).json({ error: 'NO_LICENSE' });
    } catch (error) {
        console.error('Error al validar la licencia:', error);
        return res.status(401).json({ error: 'NO_LICENSE_ERROR' });
    }
}

export { authMiddleware };