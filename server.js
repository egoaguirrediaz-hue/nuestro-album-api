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
// CONFIGURACIÓN CLOUDINARY
// =====================================================

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());

app.use(express.json());


// =====================================================
// CREAR CARPETA DATA
// =====================================================

if (!fs.existsSync(DATA_DIR)) {

    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });

}


// =====================================================
// CREAR ALBUM.JSON
// =====================================================

if (!fs.existsSync(ALBUM_FILE)) {

    fs.writeFileSync(
        ALBUM_FILE,
        JSON.stringify(
            {
                fotos: {}
            },
            null,
            2
        )
    );

}


// =====================================================
// MULTER
// =====================================================

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {

        // 50 MB
        fileSize: 50 * 1024 * 1024

    },

    fileFilter: (req, file, cb) => {

        const allowedImages = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        const allowedVideos = [
            "video/mp4",
            "video/webm",
            "video/quicktime"
        ];

        const allowed = [
            ...allowedImages,
            ...allowedVideos
        ];

        if (!allowed.includes(file.mimetype)) {

            return cb(
                new Error(
                    "Solo se permiten JPG, PNG, WEBP, MP4, WEBM o MOV."
                )
            );

        }

        cb(null, true);

    }

});


// =====================================================
// LEER ÁLBUM
// =====================================================

function readAlbum() {

    try {

        const data =
            fs.readFileSync(
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


// =====================================================
// GUARDAR ÁLBUM
// =====================================================

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


// =====================================================
// VALIDAR CLAVE
// =====================================================

function checkAdminKey(req, res, next) {

    const key =
        req.headers["x-album-key"];

    if (!key) {

        return res.status(401).json({

            success: false,

            message:
                "Falta la clave del álbum."

        });

    }

    if (
        key !==
        process.env.ALBUM_ADMIN_KEY
    ) {

        return res.status(403).json({

            success: false,

            message:
                "Clave del álbum incorrecta."

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

            message:
                "API del álbum funcionando ❤️",

            date:
                new Date().toISOString()

        });

    }
);


// =====================================================
// OBTENER ÁLBUM
// =====================================================

app.get(
    "/api/album",
    (req, res) => {

        const album =
            readAlbum();

        res.json({

            success: true,

            ...album

        });

    }
);


// =====================================================
// SUBIR FOTO / VIDEO
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

                    message:
                        "No se recibió ningún archivo."

                });

            }


            const slot =
                req.body.slot;


            if (!slot) {

                return res.status(400).json({

                    success: false,

                    message:
                        "No se indicó el espacio del archivo."

                });

            }


            // =================================================
            // DETERMINAR TIPO
            // =================================================

            const isVideo =
                req.file.mimetype.startsWith("video/");

            const tipo =
                isVideo
                    ? "video"
                    : "foto";


            const resourceType =
                isVideo
                    ? "video"
                    : "image";


            console.log(
                `Subiendo ${tipo}:`,
                req.file.originalname
            );


            // =================================================
            // SUBIR A CLOUDINARY
            // =================================================

            const result =
                await new Promise(
                    (resolve, reject) => {

                        const stream =
                            cloudinary.uploader.upload_stream(
                                {

                                    folder:
                                        "nuestro-album",

                                    resource_type:
                                        resourceType

                                },

                                (
                                    error,
                                    result
                                ) => {

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


            // =================================================
            // ORIENTACIÓN
            // =================================================

            let orientacion =
                "cuadrada";


            if (
                result.width &&
                result.height
            ) {

                if (
                    result.width >
                    result.height
                ) {

                    orientacion =
                        "horizontal";

                } else if (
                    result.height >
                    result.width
                ) {

                    orientacion =
                        "vertical";

                }

            }


            // =================================================
            // GUARDAR
            // =================================================

            const album =
                readAlbum();


            album.fotos[slot] = {

                url:
                    result.secure_url,

                public_id:
                    result.public_id,

                resource_type:
                    resourceType,

                tipo:
                    tipo,

                mimetype:
                    req.file.mimetype,

                nombre:
                    req.file.originalname,

                orientacion:
                    orientacion,

                width:
                    result.width || null,

                height:
                    result.height || null,

                duration:
                    result.duration || null,

                updatedAt:
                    new Date().toISOString()

            };


            saveAlbum(album);


            // =================================================
            // RESPUESTA
            // =================================================

            res.json({

                success: true,

                message:
                    isVideo
                        ? "Video subido correctamente ❤️"
                        : "Foto subida correctamente ❤️",

                foto:
                    album.fotos[slot]

            });


        } catch (error) {

            console.error(
                "Error subiendo archivo:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "No se pudo subir el archivo.",

                error:
                    error.message

            });

        }

    }
);


// =====================================================
// ELIMINAR FOTO / VIDEO
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
                        "No existe ningún archivo en este espacio."

                });

            }


            // =================================================
            // DETERMINAR RESOURCE TYPE
            // =================================================

            const resourceType =
                foto.resource_type ||
                (
                    foto.tipo === "video"
                        ? "video"
                        : "image"
                );


            // =================================================
            // ELIMINAR DE CLOUDINARY
            // =================================================

            if (foto.public_id) {

                try {

                    await cloudinary.uploader.destroy(

                        foto.public_id,

                        {
                            resource_type:
                                resourceType
                        }

                    );

                } catch (
                    cloudinaryError
                ) {

                    console.error(
                        "Error eliminando de Cloudinary:",
                        cloudinaryError
                    );

                }

            }


            // =================================================
            // ELIMINAR DEL ÁLBUM
            // =================================================

            delete album.fotos[slot];


            saveAlbum(album);


            res.json({

                success: true,

                message:
                    resourceType === "video"
                        ? "Video eliminado correctamente."
                        : "Foto eliminada correctamente."

            });


        } catch (error) {

            console.error(
                "Error eliminando archivo:",
                error
            );


            res.status(500).json({

                success: false,

                message:
                    "No se pudo eliminar el archivo."

            });

        }

    }
);


// =====================================================
// MANEJO DE ERRORES MULTER
// =====================================================

app.use(
    (error, req, res, next) => {

        if (
            error instanceof multer.MulterError
        ) {

            if (
                error.code ===
                "LIMIT_FILE_SIZE"
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "El archivo no puede superar los 50 MB."

                });

            }


            return res.status(400).json({

                success: false,

                message:
                    "Error procesando el archivo.",

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
