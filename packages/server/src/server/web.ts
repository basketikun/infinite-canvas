import express from "express";
import path from "node:path";

export function createStaticWeb(directory: string) {
    const router = express.Router();
    router.use(express.static(directory));
    router.get("/{*path}", (req, res, next) => {
        if (path.extname(req.path)) return next();
        res.sendFile("index.html", { root: directory });
    });
    return router;
}
