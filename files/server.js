require("dotenv").config();
// Kurumsal ağ güvenlik duvarları / SSL sertifika zinciri sorunlarını aşmak için
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const cron = require("node-cron");

const path = require("path");

// ==================================================
// AYARLAR & SABİTLER
// ==================================================

const app = express();
const PORT = process.env.PORT || 3000;

// NosyAPI REST Endpoint
const NOSY_API_BASE_URL = "https://www.nosyapi.com/apiv2/service/pharmacies-on-duty";

// MySQL Bağlantı Havuzu (.env üzerinden güvenli okuma)
const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "eczane_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==================================================
// GÜVENLİK MIDDLEWARE'LERİ & STATİK DOSYALAR
// ==================================================

// 1. Helmet: Web güvenlik HTTP başlıklarını otomatik ekler
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false
}));

// 2. CORS: İstemcilerden gelen isteklere izin verir
app.use(cors());

// 3. Statik Frontend Dosyalarını Sun (index.html, style.css, script.js)
app.use(express.static(path.join(__dirname, "../frontend")));

// 4. JSON Gövde Ayrıştırıcı (Boyut sınırı ile DoS koruması)
app.use(express.json({ limit: "10kb" }));

// 4. Rate Limiting: Spam ve DoS saldırılarına karşı IP başına dakikada maksimum 120 istek sınırı
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 120, // 1 dakikada IP başına en fazla 120 istek
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: "Çok fazla istek gönderdiniz. Lütfen bir dakika bekledikten sonra tekrar deneyiniz."
    }
});

app.use("/api/", apiLimiter);

// ==================================================
// YARDIMCI FONKSİYONLAR
// ==================================================

// Eczane adını karşılaştırmak için temizler
function temizleAd(metin) {
    if (!metin) return "";
    return metin
        .toLocaleUpperCase("tr-TR")
        .replace(/ECZANESİ|ECZANE/gi, "")
        .replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "")
        .trim();
}

// İlçe adını standartlaştırır
function temizleIlce(ilce) {
    if (!ilce) return "İzmit";
    let temiz = ilce.replace(/\s*\(.*?\)/g, "").trim();
    const ilceUpper = temiz.toLocaleUpperCase("tr-TR");
    const ilceMap = {
        "İZMİT": "İzmit",
        "IZMIT": "İzmit",
        "BAŞİSKELE": "Başiskele",
        "BASISKELE": "Başiskele",
        "ÇAYIROVA": "Çayırova",
        "CAYIROVA": "Çayırova",
        "DARICA": "Darıca",
        "DERİNCE": "Derince",
        "DERINCE": "Derince",
        "DİLOVASI": "Dilovası",
        "DILOVASI": "Dilovası",
        "GEBZE": "Gebze",
        "GÖLCÜK": "Gölcük",
        "GOLCUK": "Gölcük",
        "KANDIRA": "Kandıra",
        "KARAMÜRSEL": "Karamürsel",
        "KARAMURSEL": "Karamürsel",
        "KARTEPE": "Kartepe",
        "KÖRFEZ": "Körfez",
        "KORFEZ": "Körfez"
    };
    return ilceMap[ilceUpper] || (temiz.charAt(0).toLocaleUpperCase("tr-TR") + temiz.slice(1).toLocaleLowerCase("tr-TR"));
}

// Nöbetçi eczaneleri NosyAPI REST JSON servisi üzerinden çeker ve veritabanına kaydeder
async function nobetleriSenkronizeEt() {
    console.log("\n🔄 Günlük nöbetçi eczane senkronizasyonu başlatılıyor (NosyAPI)...");
    const apiKey = process.env.NOSY_API_KEY;

    if (!apiKey) {
        console.error("❌ HATA: .env dosyasında NOSY_API_KEY tanımlı değil!");
        return;
    }

    let toplamEklenen = 0;
    let toplamGuncellenen = 0;

    try {
        console.log("🌐 NosyAPI REST servisine bağlanılıyor...");
        const url = `${NOSY_API_BASE_URL}?city=kocaeli&apiKey=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            }
        });

        if (!response.ok) {
            console.error(`⚠️ NosyAPI HTTP Hatası: ${response.status}`);
            return;
        }

        const data = await response.json();
        const items = data.data || data.pharmacies || [];

        if (items.length === 0) {
            console.warn("⚠️ NosyAPI'den boş kayıt listesi döndü.");
            return;
        }

        console.log(`✅ NosyAPI'den ${items.length} adet nöbetçi eczane JSON olarak alındı.`);

        // Bugünün önceki nöbet kayıtlarını temizle ve güncel nöbetçileri ekle
        await pool.execute("DELETE FROM nobetler WHERE tarih = CURDATE()");
        const [dbEczaneler] = await pool.execute("SELECT id, ad, ilce FROM eczaneler");

        for (const item of items) {
            const rawName = item.pharmacyName || item.name || item.eczane_adi || "Eczane";
            const ad = rawName.includes("Eczane") || rawName.includes("ECZANE") ? rawName : `${rawName} Eczanesi`;
            const ilce = temizleIlce(item.district || item.ilce);
            const cleanName = temizleAd(ad);
            const cleanIlce = ilce.toLocaleUpperCase("tr-TR");

            let match = dbEczaneler.find(d =>
                temizleAd(d.ad) === cleanName &&
                (d.ilce ? d.ilce.toLocaleUpperCase("tr-TR") === cleanIlce : true)
            );

            let eczaneId;
            const lat = item.latitude || item.lat || null;
            const lng = item.longitude || item.lon || item.lng || null;
            const telefon = item.phone || item.telefon || null;
            const adres = item.address || item.adres || null;

            if (!match) {
                const [insertRes] = await pool.execute(
                    "INSERT INTO eczaneler (ad, telefon, adres, il, ilce, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [ad, telefon, adres, "Kocaeli", ilce, lat, lng]
                );
                eczaneId = insertRes.insertId;
                toplamEklenen++;
            } else {
                eczaneId = match.id;
                await pool.execute(
                    "UPDATE eczaneler SET lat = COALESCE(?, lat), lng = COALESCE(?, lng), telefon = COALESCE(?, telefon), adres = COALESCE(?, adres) WHERE id = ?",
                    [lat, lng, telefon, adres, eczaneId]
                );
            }

            await pool.execute(
                "INSERT INTO nobetler (eczane_id, tarih, baslangic_saati, bitis_saati) VALUES (?, CURDATE(), '08:30:00', '08:30:00') ON DUPLICATE KEY UPDATE baslangic_saati = VALUES(baslangic_saati), bitis_saati = VALUES(bitis_saati)",
                [eczaneId]
            );
            toplamGuncellenen++;
        }

        console.log(`✅ Senkronizasyon tamamlandı. (Yeni Eczane: ${toplamEklenen}, Bugünün Nöbetçi Sayısı: ${toplamGuncellenen})`);
    } catch (err) {
        console.error("❌ NosyAPI senkronizasyon hatası:", err.message);
    }
}

// ==================================================
// API ENDPOINTLERİ
// ==================================================

// 1. Tüm Eczaneler (İsteğe bağlı ilçe filtresi ile)
app.get("/api/eczaneler", async (req, res) => {
    try {
        const ilce = req.query.ilce;
        let sql = "SELECT id, ad, telefon, adres, il, ilce, lat, lng FROM eczaneler";
        const params = [];

        if (ilce && typeof ilce === "string" && ilce.trim() !== "") {
            sql += " WHERE TRIM(ilce) COLLATE utf8mb4_turkish_ci = TRIM(?) COLLATE utf8mb4_turkish_ci";
            params.push(ilce.trim());
        }

        const [results] = await pool.execute(sql, params);
        res.json(results);
    } catch (err) {
        console.error("eczaneler API hatası:", err.message);
        res.status(500).json({ error: "Eczane bilgileri alınırken bir sunucu hatası oluştu." });
    }
});

// 3. Bugünün Nöbetçi Eczaneleri (İsteğe bağlı ilçe filtresi ile)
// Örnek: /api/nobetci veya /api/nobetci?ilce=İzmit
app.get("/api/nobetci", async (req, res) => {
    try {
        const ilce = req.query.ilce;

        let sql = `
            SELECT
                e.id,
                e.ad,
                e.telefon,
                e.adres,
                e.il,
                e.ilce,
                e.lat,
                e.lng,
                n.tarih,
                n.baslangic_saati,
                n.bitis_saati
            FROM nobetler n
            JOIN eczaneler e ON n.eczane_id = e.id
            WHERE n.tarih = CURDATE()
        `;
        const params = [];

        if (ilce && typeof ilce === "string" && ilce.trim() !== "") {
            sql += " AND TRIM(e.ilce) COLLATE utf8mb4_turkish_ci = TRIM(?) COLLATE utf8mb4_turkish_ci";
            params.push(ilce.trim());
        }

        let [results] = await pool.execute(sql, params);

        // Eğer veritabanında bugün için hiç nöbet kaydı yoksa otomatik senkronize et
        if (results.length === 0) {
            const [toplamNobet] = await pool.execute("SELECT COUNT(*) as cnt FROM nobetler WHERE tarih = CURDATE()");
            if (toplamNobet[0].cnt === 0) {
                console.log("ℹ️ Bugün için nöbet kaydı bulunamadı, otomatik senkronizasyon yapılıyor...");
                await nobetleriSenkronizeEt();
                [results] = await pool.execute(sql, params);
            }
        }

        res.json(results);
    } catch (err) {
        console.error("nobetci API hatası:", err.message);
        res.status(500).json({ error: "Nöbetçi eczaneler alınırken bir sunucu hatası oluştu." });
    }
});

// 4. Manuel Senkronizasyon (Admin Anahtarlı veya Doğrudan Tetikleme)
app.get("/api/sync", async (req, res) => {
    try {
        const gelenAnahtar = req.headers["x-admin-key"] || req.query.key;
        const beklenenAnahtar = process.env.ADMIN_SYNC_SECRET;

        if (beklenenAnahtar && gelenAnahtar !== beklenenAnahtar) {
            return res.status(403).json({
                error: "Yetkisiz erişim. Bu işlem için geçerli bir x-admin-key gereklidir."
            });
        }

        await nobetleriSenkronizeEt();
        const [results] = await pool.execute("SELECT COUNT(*) as count FROM nobetler WHERE tarih = CURDATE()");
        res.json({
            status: "başarılı",
            mesaj: "Nöbetçi eczaneler başarıyla güncellendi.",
            bugunkuNobetciSayisi: results[0].count
        });
    } catch (err) {
        console.error("sync API hatası:", err.message);
        res.status(500).json({ error: "Senkronizasyon sırasında hata oluştu." });
    }
});

// ==================================================
// SUNUCU BAŞLATMA & OTOMATİK GÖREVLER
// ==================================================

app.listen(PORT, async () => {
    console.log(`🚀 Güvenli Eczane API ${PORT} portunda çalışıyor.`);

    // Sunucu açıldığında günün nöbetçi kayıtlarını kontrol et
    try {
        const [rows] = await pool.execute("SELECT COUNT(*) as cnt FROM nobetler WHERE tarih = CURDATE()");
        console.log(`📊 Veritabanında bugüne ait ${rows[0].cnt} nöbetçi eczane kaydı mevcut.`);

        if (rows[0].cnt < 12) {
            await nobetleriSenkronizeEt();
        }
    } catch (err) {
        console.error("Başlangıç kontrolü hatası:", err.message);
    }
});

// Nöbet devir-teslimi ve API servislerinin güncellenmesi genellikle 08:30-09:00 arasında gerçekleşir.
// Gece 00:05, sabah devir sonrası 08:45 ve API'nin kesin yenilendiği 09:15'te otomatik güncelleme:
const cronSaatleri = ["5 0 * * *", "45 8 * * *", "15 9 * * *"];
cronSaatleri.forEach(saat => {
    cron.schedule(saat, async () => {
        console.log(`⏰ Zamanlanmış nöbet güncelleme görevi çalıştı (${saat}).`);
        try {
            await nobetleriSenkronizeEt();
        } catch (err) {
            console.error("Cron senkronizasyon hatası:", err.message);
        }
    });
});