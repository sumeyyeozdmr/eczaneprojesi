const https = require("https");
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const mysql = require("mysql2");

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "13Haz2013",
    database: "eczane_db"
});

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Eczane API Çalışıyor.");
});

app.get("/api/eczaneler", (req, res) => {
    const ilce = req.query.ilce;
    let sql = "SELECT * FROM eczaneler";
    let params = [];

    if (ilce) {
        sql += " WHERE ilce = ?";
        params.push(ilce);
    }

    db.query(sql, params, (err, results) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(results);
    });
});

app.get("/api/nobetci", (req, res) => {
    const ilce = req.query.ilce;
    let sql = `
        SELECT
            eczaneler.id,
            eczaneler.ad,
            eczaneler.telefon,
            eczaneler.adres,
            eczaneler.ilce,
            eczaneler.lat,
            eczaneler.lng,
            nobetler.tarih,
            nobetler.baslangic_saati,
            nobetler.bitis_saati
        FROM nobetler
        JOIN eczaneler
            ON nobetler.eczane_id = eczaneler.id
        WHERE nobetler.tarih = CURDATE()
    `;

    let params = [];

    if (ilce) {
        sql += " AND eczaneler.ilce = ?";
        params.push(ilce);
    }

    db.query(sql, params, (err, results) => {
        if (err) {
            return res.status(500).json({
                error: err.message
            });
        }
        res.json(results);
    });
});

app.get("/api/kaynak-nobet", (req, res) => {
    const url = `https://eczane.te-robotik.com.tr/api/v1/nobetci?il=${encodeURIComponent("KOCAELİ")}&ilce=${encodeURIComponent("İZMİT")}&gun=bugun`;

    https.get(url, (apiRes) => {
        let veri = "";

        apiRes.on("data", (parca) => {
            veri += parca;
        });

        apiRes.on("end", () => {
            try {
                res.json(JSON.parse(veri));
            } catch (err) {
                res.status(500).json({ error: "JSON okuma hatası: " + err.message });
            }
        });

    }).on("error", (err) => {
        res.status(500).json({ error: err.message });
    });
});

async function nobetleriGuncelle() {
    try {
        const ilceResponse = await fetch(
            `https://eczane.te-robotik.com.tr/api/v1/ilceler?il=${encodeURIComponent("KOCAELİ")}`
        );

        const ilceVerisi = await ilceResponse.json();
        const ilceler = ilceVerisi.ilceler || [];

        const sonuclar = await Promise.all(
            ilceler.map(async (ilce) => {
                try {
                    const url = `https://eczane.te-robotik.com.tr/api/v1/nobetci?il=${encodeURIComponent("KOCAELİ")}&ilce=${encodeURIComponent(ilce)}&gun=bugun`;
                    const apiRes = await fetch(url);

                    if (!apiRes.ok) {
                        return {
                            ilce,
                            durum: "hata",
                            mesaj: `HTTP ${apiRes.status}`
                        };
                    }

                    const kaynak = await apiRes.json();

                    if (!kaynak || !Array.isArray(kaynak.eczaneler)) {
                        return {
                            ilce,
                            durum: "hata",
                            mesaj: "Eczane listesi bulunamadı"
                        };
                    }

                    let bulunan = 0;
                    let bulunamayan = 0;
                    const eksikler = [];

                    for (const eczane of kaynak.eczaneler) {
                        const telefon = (eczane.telefon || "")
                            .replace(/\D/g, "")
                            .replace(/^0/, "");

                        const [results] = await db.promise().query(
                            "SELECT id FROM eczaneler WHERE RIGHT(telefon, 10) = ?",
                            [telefon]
                        );

                        if (results.length === 0) {
                            bulunamayan++;
                            eksikler.push({
                                ad: eczane.ad,
                                telefon: eczane.telefon
                            });
                            continue;
                        }

                        const eczaneId = results[0].id;
                        const baslangic = eczane.nobet_baslangic ? eczane.nobet_baslangic.split(" ")[0] : null;
                        const bitis = eczane.nobet_bitis ? eczane.nobet_bitis.split(" ")[0] : null;

                        await db.promise().query(
                            `INSERT IGNORE INTO nobetler
                            (eczane_id, tarih, baslangic_saati, bitis_saati)
                            VALUES (?, ?, ?, ?)`,
                            [
                                eczaneId,
                                kaynak.tarih,
                                baslangic,
                                bitis
                            ]
                        );

                        bulunan++;
                    }

                    return {
                        ilce,
                        durum: "başarılı",
                        bulunan,
                        bulunamayan,
                        eksikler
                    };

                } catch (err) {
                    return {
                        ilce,
                        durum: "hata",
                        mesaj: err.message
                    };
                }
            })
        );

        return sonuclar;

    } catch (err) {
        throw err;
    }
}

app.get("/api/nobet-kaydet", async (req, res) => {
    try {
        const sonuclar = await nobetleriGuncelle();
        res.json(sonuclar);
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

db.connect((baglantiHatasi) => {
    if (baglantiHatasi) {
        console.error("Veritabanına bağlanılamadı: ", baglantiHatasi);
    } else {
        console.log("Veritabanına başarıyla bağlandı.");
    }
});

app.listen(PORT, () => {
    console.log(`Eczane API ${PORT} portunda çalışıyor`);
});

cron.schedule("0 6 * * *", async () => {
    console.log("Günlük nöbet güncellemesi başladı.");
    try {
        await nobetleriGuncelle();
        console.log("Günlük nöbet güncellemesi tamamlandı.");
    } catch (err) {
        console.error("Cron hatası:", err.message);
    }
});