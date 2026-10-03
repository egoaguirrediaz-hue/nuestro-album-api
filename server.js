require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, "data");
const ALBUM_FILE = path.join(DATA_DIR, "album.json");

// Copia del álbum en Cloudinary (Render borra los archivos al reiniciar)
const BACKUP_ID = "nuestro-album/album-data.json";

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json());

// =====================================================
// ARCHIVO DEL ÁLBUM
// =====================================================

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(ALBUM_FILE)) {
    fs.writeFileSync(ALBUM_FILE, JSON.stringify({ fotos: {}, textos: {} }, null, 2));
}

function readAlbum() {
    try {
        const album = JSON.parse(fs.readFileSync(ALBUM_FILE, "utf8"));
        album.fotos = album.fotos || {};
        album.textos = album.textos || {};
        return album;
    } catch (error) {
        console.error("Error leyendo album.json:", error);
        return { fotos: {}, textos: {} };
    }
}

function saveAlbum(album) {
    fs.writeFileSync(ALBUM_FILE, JSON.stringify(album, null, 2));
    scheduleBackup();
}

// =====================================================
// RESPALDO EN CLOUDINARY
// =====================================================

const withTimeout = (promise, ms) =>
    Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))
    ]);

let backupTimer = null;

function scheduleBackup() {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
        const buffer = Buffer.from(JSON.stringify(readAlbum()));
        cloudinary.uploader
            .upload_stream(
                {
                    public_id: BACKUP_ID,
                    resource_type: "raw",
                    overwrite: true,
                    invalidate: true
                },
                error => {
                    if (error) console.error("Error respaldando el álbum:", error.message || error);
                    else console.log("Respaldo del álbum guardado en Cloudinary ❤️");
                }
            )
            .end(buffer);
    }, 1000);
}

async function restoreAlbum() {
    try {
        const info = await withTimeout(
            cloudinary.api.resource(BACKUP_ID, { resource_type: "raw" }),
            10000
        );
        const response = await withTimeout(fetch(info.secure_url), 10000);
        if (!response.ok) throw new Error("HTTP " + response.status);

        const data = await response.json();
        fs.writeFileSync(
            ALBUM_FILE,
            JSON.stringify({ fotos: data.fotos || {}, textos: data.textos || {} }, null, 2)
        );
        console.log("Álbum restaurado desde Cloudinary ❤️");
    } catch (error) {
        const code = (error && error.error && error.error.http_code) || (error && error.http_code);

        if (code === 404) {
            // Primera vez: todavía no existe copia. Se crea con lo que haya.
            console.log("No había respaldo en Cloudinary. Creando el primero.");
            scheduleBackup();
        } else {
            // No se respalda para no pisar una copia buena por un error temporal.
            console.error("No se pudo restaurar el álbum:", (error && error.message) || error);
        }
    }
}

// =====================================================
// MULTER
// =====================================================

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP."));
        }
        cb(null, true);
    }
});

// =====================================================
// CLAVE
// =====================================================

function checkAdminKey(req, res, next) {
    const key = req.headers["x-album-key"];

    if (!key) {
        return res.status(401).json({ success: false, message: "Falta la clave del álbum." });
    }
    if (key !== process.env.ALBUM_ADMIN_KEY) {
        return res.status(403).json({ success: false, message: "Clave del álbum incorrecta." });
    }
    next();
}

// =====================================================
// RUTAS
// =====================================================

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "API del álbum funcionando ❤️",
        date: new Date().toISOString()
    });
});

app.get("/api/album", (req, res) => {
    res.json({ success: true, ...readAlbum() });
});

// ----- Subir foto -----
app.post("/api/upload", checkAdminKey, upload.single("foto"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No se recibió ninguna foto." });
        }

        const slot = req.body.slot;
        if (!slot) {
            return res.status(400).json({ success: false, message: "No se indicó el espacio de la foto." });
        }

        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { folder: "nuestro-album", resource_type: "image" },
                (error, result) => (error ? reject(error) : resolve(result))
            );
            stream.end(req.file.buffer);
        });

        let orientacion = "cuadrada";
        if (result.width > result.height) orientacion = "horizontal";
        else if (result.height > result.width) orientacion = "vertical";

        const album = readAlbum();
        album.fotos[slot] = {
            url: result.secure_url,
            public_id: result.public_id,
            orientacion,
            width: result.width,
            height: result.height,
            updatedAt: new Date().toISOString()
        };
        saveAlbum(album);

        res.json({
            success: true,
            message: "Foto subida correctamente ❤️",
            foto: album.fotos[slot]
        });
    } catch (error) {
        console.error("Error subiendo foto:", error);
        res.status(500).json({
            success: false,
            message: "No se pudo subir la foto.",
            error: error.message
        });
    }
});

// ----- Guardar un texto (leyenda, fecha, título, dedicatoria o carta) -----
app.put("/api/texto", checkAdminKey, (req, res) => {
    const { clave, texto } = req.body || {};

    if (typeof clave !== "string" || !/^(foto-\d+|fecha-foto-\d+|titulo|dedicatoria|carta)$/.test(clave)) {
        return res.status(400).json({ success: false, message: "Clave de texto no válida." });
    }
    if (typeof texto !== "string") {
        return res.status(400).json({ success: false, message: "Texto no válido." });
    }

    if (clave.startsWith("fecha-")) {
        if (!/^(\d{4}-\d{2}-\d{2})?$/.test(texto)) {
            return res.status(400).json({ success: false, message: "Fecha no válida." });
        }
    } else {
        const max = clave === "carta" ? 1500 : 300;
        if (texto.length > max) {
            return res.status(400).json({ success: false, message: `El texto debe tener máximo ${max} caracteres.` });
        }
    }

    const album = readAlbum();
    album.textos[clave] = texto.trim();
    saveAlbum(album);

    res.json({ success: true });
});

// ----- Eliminar foto -----
app.delete("/api/photo/:slot", checkAdminKey, async (req, res) => {
    try {
        const slot = req.params.slot;
        const album = readAlbum();
        const foto = album.fotos[slot];

        if (!foto) {
            return res.status(404).json({
                success: false,
                message: "No existe una foto en este espacio."
            });
        }

        if (foto.public_id) {
            try {
                await cloudinary.uploader.destroy(foto.public_id, { resource_type: "image" });
            } catch (cloudinaryError) {
                console.error("Error eliminando Cloudinary:", cloudinaryError);
            }
        }

        delete album.fotos[slot];
        saveAlbum(album);

        res.json({ success: true, message: "Foto eliminada correctamente." });
    } catch (error) {
        console.error("Error eliminando foto:", error);
        res.status(500).json({ success: false, message: "No se pudo eliminar la foto." });
    }
});

// =====================================================
// ERRORES
// =====================================================

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: "Error procesando la imagen.",
            error: error.message
        });
    }
    if (error) {
        return res.status(400).json({ success: false, message: error.message });
    }
    next();
});

// =====================================================
// INICIAR (primero se recupera el álbum guardado)
// =====================================================

restoreAlbum().finally(() => {
    app.listen(PORT, () => {
        console.log("======================================");
        console.log(" ❤️  API NUESTRO ÁLBUM");
        console.log("======================================");
        console.log(`Servidor: http://localhost:${PORT}`);
        console.log(`Health:   http://localhost:${PORT}/api/health`);
        console.log(`Álbum:    http://localhost:${PORT}/api/album`);
        console.log("======================================");
    });
});
