require("dotenv").config();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const mysql = require("mysql2/promise");

const NOSY_API_BASE_URL = "https://www.nosyapi.com/apiv2/service/pharmacies-on-duty";

function temizleAd(metin) {
    if (!metin) return "";
    return metin
        .toLocaleUpperCase("tr-TR")
        .replace(/ECZANESİ|ECZANE/gi, "")
        .replace(/[^A-ZÇĞİÖŞÜ0-9]/g, "")
        .trim();
}

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

async function main() {
    const apiKey = process.env.NOSY_API_KEY;
    if (!apiKey) {
        throw new Error(".env dosyasında NOSY_API_KEY tanımlı değil!");
    }

    const db = await mysql.createConnection({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASS || "",
        database: process.env.DB_NAME || "eczane_db"
    });

    console.log("\n========================================");
    console.log("NOSY API → BUGÜNÜN NÖBETÇİLERİNİ KAYDET");
    console.log("========================================");

    console.log("🌐 NosyAPI REST JSON servisinden nöbetçiler çekiliyor...");
    const url = `${NOSY_API_BASE_URL}?city=kocaeli&apiKey=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
    });

    if (!response.ok) {
        throw new Error(`NosyAPI HTTP Hatası: ${response.status}`);
    }

    const data = await response.json();
    const nobetciler = data.data || data.pharmacies || [];
    console.log(`✅ ${nobetciler.length} nöbetçi eczane JSON olarak listelendi.`);

    // Bugünün önceki kayıtlarını temizle
    await db.execute("DELETE FROM nobetler WHERE tarih = CURDATE()");

    const [dbEczaneler] = await db.execute("SELECT id, ad, ilce FROM eczaneler");

    let toplamKaydedilen = 0;

    for (const apiEczane of nobetciler) {
        const rawName = apiEczane.pharmacyName || apiEczane.name || "Eczane";
        const eczaneAdi = rawName.includes("Eczane") || rawName.includes("ECZANE") ? rawName : `${rawName} Eczanesi`;
        const ilce = temizleIlce(apiEczane.district || apiEczane.ilce);
        const cleanApi = temizleAd(eczaneAdi);
        const cleanIlce = ilce.toLocaleUpperCase("tr-TR");

        let match = dbEczaneler.find(d =>
            temizleAd(d.ad) === cleanApi &&
            (d.ilce ? d.ilce.toLocaleUpperCase("tr-TR") === cleanIlce : true)
        );

        let eczaneId;
        const lat = apiEczane.latitude || apiEczane.lat || null;
        const lng = apiEczane.longitude || apiEczane.lon || apiEczane.lng || null;
        const phone = apiEczane.phone || apiEczane.telefon || null;
        const address = apiEczane.address || apiEczane.adres || null;

        if (!match) {
            const [insertRes] = await db.execute(
                "INSERT INTO eczaneler (ad, telefon, adres, il, ilce, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    eczaneAdi,
                    phone,
                    address,
                    "Kocaeli",
                    ilce,
                    lat,
                    lng
                ]
            );
            eczaneId = insertRes.insertId;
            console.log(`➕ Yeni eczane kaydedildi → DB ID: ${eczaneId} ([${ilce}] ${eczaneAdi})`);
        } else {
            eczaneId = match.id;
            console.log(`✅ Eşleşme bulundu → DB ID: ${eczaneId} (${match.ad})`);

            await db.execute(
                "UPDATE eczaneler SET lat = COALESCE(?, lat), lng = COALESCE(?, lng), telefon = COALESCE(?, telefon), adres = COALESCE(?, adres) WHERE id = ?",
                [lat, lng, phone, address, eczaneId]
            );
        }

        await db.execute(
            "INSERT INTO nobetler (eczane_id, tarih, baslangic_saati, bitis_saati) VALUES (?, CURDATE(), '08:30:00', '08:30:00') ON DUPLICATE KEY UPDATE baslangic_saati = VALUES(baslangic_saati), bitis_saati = VALUES(bitis_saati)",
            [eczaneId]
        );

        toplamKaydedilen++;
    }

    const [toplam] = await db.execute("SELECT COUNT(*) as cnt FROM nobetler WHERE tarih = CURDATE()");
    console.log("\n========================================");
    console.log(`İŞLEM TAMAMLANDI: Bugün için toplam ${toplam[0].cnt} nöbetçi eczane kaydedildi.`);
    console.log("========================================");

    await db.end();
}

main().catch(error => {
    console.error("\n❌ HATA:", error);
});