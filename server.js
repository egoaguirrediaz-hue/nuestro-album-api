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

// =====================================================
// CONFIGURACIÓN
// =====================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());

app.use(express.json());


// =====================================================
// CREAR CARPETA DATA SI NO EXISTE
// =====================================================

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}


// =====================================================
// CREAR ALBUM.JSON SI NO EXISTE
// =====================================================

if (!fs.existsSync(ALBUM_FILE)) {
    fs.writeFileSync(
        ALBUM_FILE,
        JSON.stringify({
            fotos: {}
        }, null, 2)
    );
}


// =====================================================
// MULTER
// =====================================================

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(
                new Error(
                    "Solo se permiten imágenes JPG, PNG o WEBP."
                )
            );
        }

        cb(null, true);
    }
});


// =====================================================
// FUNCIONES
// =====================================================

function readAlbum() {

    try {

        const data = fs.readFileSync(
            ALBUM_FILE,
            "utf8"
        );

        return JSON.parse(data);

    } catch (error) {

        console.error(
            "Error leyendo album.json:",
            error
        );

        return {
            fotos: {}
        };
    }
}


function saveAlbum(album) {

    fs.writeFileSync(
        ALBUM_FILE,
        JSON.stringify(
            album,
            null,
            2
        )
    );
}


function checkAdminKey(req, res, next) {

    const key = req.headers["x-album-key"];

    if (!key) {

        return res.status(401).json({
            success: false,
            message: "Falta la clave del álbum."
        });
    }

    if (key !== process.env.ALBUM_ADMIN_KEY) {

        return res.status(403).json({
            success: false,
            message: "Clave del álbum incorrecta."
        });
    }

    next();
}


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            success: true,
            message: "API del álbum funcionando ❤️",
            date: new Date().toISOString()
        });

    }
);


// =====================================================
// OBTENER ÁLBUM
// =====================================================

app.get(
    "/api/album",
    (req, res) => {

        const album = readAlbum();

        res.json({
            success: true,
            ...album
        });

    }
);


// =====================================================
// SUBIR FOTO
// =====================================================

app.post(
    "/api/upload",
    checkAdminKey,
    upload.single("foto"),

    async (req, res) => {

        try {

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "No se recibió ninguna foto."
                });

            }

            const slot = req.body.slot;

            if (!slot) {

                return res.status(400).json({
                    success: false,
                    message: "No se indicó el espacio de la foto."
                });

            }


            // -----------------------------------------
            // SUBIR A CLOUDINARY
            // -----------------------------------------

            const result =
                await new Promise(
                    (resolve, reject) => {

                        const stream =
                            cloudinary.uploader.upload_stream(
                                {
                                    folder: "nuestro-album",
                                    resource_type: "image"
                                },

                                (error, result) => {

                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve(result);
                                    }

                                }
                            );

                        stream.end(
                            req.file.buffer
                        );

                    }
                );


            // -----------------------------------------
            // DETERMINAR ORIENTACIÓN
            // -----------------------------------------

            let orientacion = "cuadrada";

            if (
                result.width >
                result.height
            ) {

                orientacion = "horizontal";

            } else if (
                result.height >
                result.width
            ) {

                orientacion = "vertical";

            }


            // -----------------------------------------
            // GUARDAR INFORMACIÓN
            // -----------------------------------------

            const album = readAlbum();

            album.fotos[slot] = {

                url: result.secure_url,

                public_id: result.public_id,

                orientacion: orientacion,

                width: result.width,

                height: result.height,

                updatedAt:
                    new Date().toISOString()

            };

            saveAlbum(album);


            // -----------------------------------------
            // RESPUESTA
            // -----------------------------------------

            res.json({

                success: true,

                message: "Foto subida correctamente ❤️",

                foto: album.fotos[slot]

            });


        } catch (error) {

            console.error(
                "Error subiendo foto:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "No se pudo subir la foto.",

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// ELIMINAR FOTO
// =====================================================

app.delete(
    "/api/photo/:slot",
    checkAdminKey,

    async (req, res) => {

        try {

            const slot =
                req.params.slot;

            const album =
                readAlbum();

            const foto =
                album.fotos[slot];


            if (!foto) {

                return res.status(404).json({

                    success: false,

                    message:
                        "No existe una foto en este espacio."

                });

            }


            // -----------------------------------------
            // ELIMINAR DE CLOUDINARY
            // -----------------------------------------

            if (foto.public_id) {

                try {

                    await cloudinary.uploader.destroy(
                        foto.public_id,
                        {
                            resource_type: "image"
                        }
                    );

                } catch (cloudinaryError) {

                    console.error(
                        "Error eliminando Cloudinary:",
                        cloudinaryError
                    );

                }

            }


            // -----------------------------------------
            // ELIMINAR DEL ÁLBUM
            // -----------------------------------------

            delete album.fotos[slot];

            saveAlbum(album);


            res.json({

                success: true,

                message:
                    "Foto eliminada correctamente."

            });


        } catch (error) {

            console.error(
                "Error eliminando foto:",
                error
            );

            res.status(500).json({

                success: false,

                message:
                    "No se pudo eliminar la foto."

            });

        }

    }
);


// =====================================================
// MANEJO DE ERRORES DE MULTER
// =====================================================

app.use(
    (error, req, res, next) => {

        if (
            error instanceof multer.MulterError
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Error procesando la imagen.",

                error:
                    error.message

            });

        }


        if (error) {

            return res.status(400).json({

                success: false,

                message:
                    error.message

            });

        }

        next();

    }
);


// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "======================================"
        );

        console.log(
            " ❤️  API NUESTRO ÁLBUM"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Servidor: http://localhost:${PORT}`
        );

        console.log(
            `Health:   http://localhost:${PORT}/api/health`
        );

        console.log(
            `Álbum:    http://localhost:${PORT}/api/album`
        );

        console.log(
            "======================================"
        );

        console.log("");

    }
);