// ==========================================================================
// KOCAELİ NÖBETÇİ ECZANE UYGULAMASI (KOCAELİ GENELİ TÜM İLÇELER)
// ==========================================================================

const API_URL = "http://localhost:3000/api/nobetci";

// Harita ve Marker Yönetimi
let harita = null;
let markerlar = [];
let sonYuklenenEczaneler = [];
let sonKullaniciKonumu = null;

// DOM Elemanları
const konumButonu = document.getElementById("konumButonu");
const ilceSecimi = document.getElementById("ilce");
const araButonu = document.getElementById("araButonu");
const eczaneListesi = document.getElementById("eczaneListesi");
const eczaneSayisi = document.getElementById("eczaneSayisi");
const listeBaslikAciklama = document.getElementById("listeBaslikAciklama");

// En Yakın Eczane Kartı Elemanları
const enYakinKart = document.querySelector(".nearest-card");
const enYakinEczane = document.getElementById("enYakinEczane");
const enYakinAdres = document.getElementById("enYakinAdres");
const enYakinTelefon = document.getElementById("enYakinTelefon");
const enYakinMesafe = document.getElementById("enYakinMesafe");
const enYakinNobet = document.getElementById("enYakinNobet");
const araTelefon = document.getElementById("araTelefon");
const paylas = document.getElementById("paylas");

let aktifEnYakinVeri = null;

// ==========================================================================
// YARDIMCI VE UI FONKSİYONLARI
// ==========================================================================

function yukleniyorGoster(mesaj = "Eczaneler aranıyor...") {
    if (!eczaneListesi) return;
    eczaneListesi.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>${mesaj}</p>
        </div>
    `;
    if (eczaneSayisi) eczaneSayisi.textContent = "...";
}

function hataGoster(mesaj = "Eczane bilgileri alınırken bir sorun oluştu.") {
    if (!eczaneListesi) return;
    eczaneListesi.innerHTML = `
        <div class="empty-state">
            <div>⚠️</div>
            <strong>Bilgiler Yüklenemedi</strong>
            <p>${mesaj}</p>
        </div>
    `;
    if (eczaneSayisi) eczaneSayisi.textContent = "0 eczane";
}

function bosDurumGoster(mesaj = "Seçtiğiniz kriterlere uygun nöbetçi eczane bulunamadı.") {
    if (!eczaneListesi) return;
    eczaneListesi.innerHTML = `
        <div class="empty-state">
            <div>💊</div>
            <strong>Nöbetçi eczane bulunamadı</strong>
            <p>${mesaj}</p>
        </div>
    `;
    if (eczaneSayisi) eczaneSayisi.textContent = "0 eczane";
}

function butonDurumuAyarla(pasifMi) {
    if (araButonu) araButonu.disabled = pasifMi;
    if (konumButonu) konumButonu.disabled = pasifMi;
    if (ilceSecimi) ilceSecimi.disabled = pasifMi;
}

function aramaYap(telefon) {
    if (!telefon) {
        alert("Bu eczanenin kayıtlı telefon numarası bulunmuyor.");
        return;
    }
    const temizTel = telefon.replace(/\D/g, "");
    window.location.href = `tel:${temizTel}`;
}

function eczanePaylas(ad, adres, mapsUrl) {
    const paylasimMetni = `${ad}\n📍 ${adres}`;
    if (navigator.share) {
        navigator.share({
            title: ad,
            text: paylasimMetni,
            url: mapsUrl || window.location.href
        }).catch(() => {});
    } else if (navigator.clipboard) {
        navigator.clipboard.writeText(paylasimMetni);
        alert("Eczane bilgileri panoya kopyalandı.");
    } else {
        alert(paylasimMetni);
    }
}

// ==========================================================================
// HAVERSINE FORMÜLÜ: İKİ KOORDİNAT ARASI GERÇEK MESAFE HESAPLAMA
// ==========================================================================
function mesafeHesaplaMetre(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Dünya yarıçapı (metre)
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}

// ==========================================================================
// API VERİ ÇEKME
// ==========================================================================
async function eczaneVerileriniGetir(ilceFiltresi = null) {
    let url = API_URL;

    if (ilceFiltresi && ilceFiltresi.trim() !== "") {
        url += `?ilce=${encodeURIComponent(ilceFiltresi.trim())}`;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: "application/json"
            }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API HTTP hatası: ${response.status}`);
        }

        const data = await response.json();
        console.log("Kocaeli Eczane API verisi:", data);

        const liste = Array.isArray(data) ? data : (data.sonuc || data.eczaneler || []);

        const gelenEczaneler = liste.map(item => ({
            id: item.id,
            ad: item.ad || item.name || item.eczane_adi || "Eczane",
            ilce: item.ilce || item.district || "",
            adres: item.adres || item.address || "Adres belirtilmemiş",
            telefon: item.telefon || item.phone || "",
            lat: parseFloat(item.lat || item.latitude || item.enlem),
            lng: parseFloat(item.lng || item.lon || item.longitude || item.boylam),
            tarih: item.tarih,
            baslangic_saati: item.baslangic_saati,
            bitis_saati: item.bitis_saati,
            mapsUrl: item.lat && (item.lng || item.lon)
                ? `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng || item.lon}`
                : ""
        }));

        return gelenEczaneler;
    } catch (err) {
        console.error("Eczane API hatası:", err);
        throw err;
    }
}

// ==========================================================================
// HARİTADA ECZANEYE VE BİLGİ PENCERESİNE ODAKLANMA (MERKEZİ ORTALAMA)
// ==========================================================================
function eczaneyeOdaklan(eczaneAdi) {
    if (!harita || !eczaneAdi) return;

    const secilenMarker = markerlar.find(m => m.eczaneAdi === eczaneAdi);
    if (!secilenMarker) return;

    // Önceki açık bilgi pencerelerini kapat
    markerlar.forEach(m => {
        if (m.bilgiPenceresi) m.bilgiPenceresi.close();
    });

    harita.setZoom(16);
    harita.panTo(secilenMarker.getPosition());

    if (secilenMarker.bilgiPenceresi) {
        secilenMarker.bilgiPenceresi.open({
            anchor: secilenMarker,
            map: harita
        });

        // Bilgi penceresi marker pininin üzerinde açıldığı için haritayı dikeyde tam merkeze al
        setTimeout(() => {
            if (harita) {
                harita.panBy(0, -95);
            }
        }, 120);
    }
}

// ==========================================================================
// EN YAKIN KART ETKİLEŞİMLERİ
// ==========================================================================
if (enYakinKart) {
    enYakinKart.addEventListener("click", function (event) {
        if (event.target.closest("button")) return;

        if (aktifEnYakinVeri && aktifEnYakinVeri.ad) {
            eczaneyeOdaklan(aktifEnYakinVeri.ad);
        }
    });
}

if (araTelefon) {
    araTelefon.addEventListener("click", function (e) {
        e.stopPropagation();
        if (aktifEnYakinVeri && aktifEnYakinVeri.telefon) {
            aramaYap(aktifEnYakinVeri.telefon);
        } else {
            alert("Telefon numarası bulunamadı.");
        }
    });
}

if (paylas) {
    paylas.addEventListener("click", function (e) {
        e.stopPropagation();
        if (aktifEnYakinVeri) {
            eczanePaylas(aktifEnYakinVeri.ad, aktifEnYakinVeri.adres, aktifEnYakinVeri.mapsUrl);
        }
    });
}

// ==========================================================================
// İLÇE BAZLI ECZANE ARAMA
// ==========================================================================
async function ilceAra(secilenIlce = null) {
    const ilce = secilenIlce !== null ? secilenIlce : (ilceSecimi ? ilceSecimi.value : "");
    if (enYakinKart) enYakinKart.style.display = "none";

    if (!ilce || ilce.trim() === "") {
        // İlçe seçilmediyse tüm Kocaeli'yi listele
        if (listeBaslikAciklama) {
            listeBaslikAciklama.textContent = "Kocaeli genelindeki nöbetçi eczaneler";
        }
        yukleniyorGoster("Kocaeli genelindeki nöbetçi eczaneler yükleniyor...");
        butonDurumuAyarla(true);

        try {
            const eczaneler = await eczaneVerileriniGetir(null);
            renderEczaneler(eczaneler, false);
        } catch (error) {
            console.error("Eczane listesi hatası:", error);
            hataGoster("Eczane sunucusuna (localhost:3000) bağlanılamadı. Lütfen 'node server.js' komutu ile sunucunun çalıştığından emin olun.");
        } finally {
            butonDurumuAyarla(false);
        }
        return;
    }

    if (listeBaslikAciklama) {
        listeBaslikAciklama.textContent = `${ilce} ilçesindeki nöbetçi eczaneler`;
    }

    yukleniyorGoster(`${ilce} ilçesindeki nöbetçi eczaneler yükleniyor...`);
    butonDurumuAyarla(true);

    try {
        const eczaneler = await eczaneVerileriniGetir(ilce);
        renderEczaneler(eczaneler, false);
    } catch (error) {
        console.error("Eczane getirme hatası:", error);
        hataGoster(`${ilce} ilçesi için bilgiler alınamadı. Sunucunun çalıştığından emin olunuz.`);
    } finally {
        butonDurumuAyarla(false);
    }
}

// İlçe açılır menüsü değiştiğinde ANINDA arama yap
if (ilceSecimi) {
    ilceSecimi.addEventListener("change", function () {
        ilceAra(this.value);
    });
}

// Arama butonuna tıklandığında arama yap
if (araButonu) {
    araButonu.addEventListener("click", () => {
        const seciliIlce = ilceSecimi ? ilceSecimi.value : "";
        ilceAra(seciliIlce);
    });
}

// ==========================================================================
// KONUM BAZLI EN YAKIN ECZANE ARAMA
// ==========================================================================
if (konumButonu) {
    konumButonu.addEventListener("click", function () {
        if (!navigator.geolocation) {
            alert("Tarayıcınız konum özelliğini desteklemiyor.");
            return;
        }

        yukleniyorGoster("Konumunuz alınıyor...");
        butonDurumuAyarla(true);

        const geoOptions = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        };

        navigator.geolocation.getCurrentPosition(
            async function (position) {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;

                yukleniyorGoster("En yakın nöbetçi eczaneler hesaplanıyor...");

                try {
                    const tumEczaneler = await eczaneVerileriniGetir(null);

                    // Her eczane için kullanıcının konumuna göre mesafeyi hesapla
                    const mesafeliEczaneler = tumEczaneler.map(eczane => {
                        const m = mesafeHesaplaMetre(userLat, userLng, eczane.lat, eczane.lng);
                        return {
                            ...eczane,
                            mesafe_m: m
                        };
                    });

                    // En yakından en uzağa sırala
                    mesafeliEczaneler.sort((a, b) => a.mesafe_m - b.mesafe_m);

                    if (listeBaslikAciklama) {
                        listeBaslikAciklama.textContent = "Konumunuza en yakın nöbetçi eczaneler";
                    }

                    if (mesafeliEczaneler.length > 0) {
                        if (enYakinKart) enYakinKart.style.display = "block";
                        aktifEnYakinVeri = mesafeliEczaneler[0];

                        if (enYakinEczane) enYakinEczane.textContent = aktifEnYakinVeri.ad || "Bilinmiyor";
                        if (enYakinAdres) enYakinAdres.textContent = aktifEnYakinVeri.adres || "Adres bilgisi bulunmuyor";
                        if (enYakinTelefon) enYakinTelefon.textContent = aktifEnYakinVeri.telefon || "Telefon bilgisi bulunmuyor";

                        const mesafeM = aktifEnYakinVeri.mesafe_m;
                        if (enYakinMesafe) {
                            enYakinMesafe.textContent = mesafeM < 1000 ? `${mesafeM} m` : `${(mesafeM / 1000).toFixed(1)} km`;
                        }
                        if (enYakinNobet) enYakinNobet.textContent = "Nöbetçi";
                    } else if (enYakinKart) {
                        enYakinKart.style.display = "none";
                    }

                    renderEczaneler(mesafeliEczaneler, true, { lat: userLat, lng: userLng });
                } catch (error) {
                    console.error("Konum hesaplama hatası:", error);
                    hataGoster("En yakın eczaneler listelenirken bir sorun oluştu.");
                } finally {
                    butonDurumuAyarla(false);
                }
            },
            function (error) {
                console.error("Konum alma hatası:", error);
                butonDurumuAyarla(false);

                let hataMesaji = "Konumunuz alınamadı. Lütfen tarayıcınızın konum iznini kontrol ediniz.";
                if (error.code === error.TIMEOUT) {
                    hataMesaji = "Konum alma zaman aşımına uğradı. Lütfen ilçe seçerek arama yapınız.";
                } else if (error.code === error.PERMISSION_DENIED) {
                    hataMesaji = "Konum izni reddedildi. Arama yapmak için lütfen yukarıdan ilçe seçiniz.";
                }

                hataGoster(hataMesaji);
            },
            geoOptions
        );
    });
}

// ==========================================================================
// ECZANELERİ LİSTEYE BASMA (PERFORMANS ODAKLI)
// ==========================================================================
function renderEczaneler(eczaneler, konumModu = false, kullaniciKonumu = null) {
    sonYuklenenEczaneler = eczaneler || [];
    sonKullaniciKonumu = kullaniciKonumu;

    if (!eczaneListesi) return;
    eczaneListesi.innerHTML = "";

    if (!eczaneler || eczaneler.length === 0) {
        bosDurumGoster();
        eczaneleriHaritadaGoster([], kullaniciKonumu);
        return;
    }

    if (eczaneSayisi) eczaneSayisi.textContent = `${eczaneler.length} eczane`;

    const fragment = document.createDocumentFragment();

    eczaneler.forEach(eczane => {
        const eczaneDiv = document.createElement("div");
        eczaneDiv.className = "pharmacy-item";

        let mesafeBadge = "";
        if (konumModu && eczane.mesafe_m !== undefined) {
            const m = eczane.mesafe_m;
            const mesafeMetni = m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
            mesafeBadge = `<span class="distance">📍 ${mesafeMetni}</span>`;
        }

        const ilceBadge = eczane.ilce ? `<span style="font-size: 11px; background: rgba(30, 41, 59, 0.08); padding: 2px 8px; border-radius: 12px; margin-left: 6px; color: #475569; font-weight: 500;">${eczane.ilce}</span>` : "";

        eczaneDiv.innerHTML = `
            <div class="pharmacy-card-content">
                <strong>${eczane.ad} ${ilceBadge}</strong>
                <p>📍 ${eczane.adres || "Adres belirtilmemiş"}</p>
                <p>📞 ${eczane.telefon || "Telefon bilgisi bulunmuyor"}</p>
                ${mesafeBadge}
                <div class="pharmacy-card-buttons">
                    <button class="small-call-button" data-tel="${eczane.telefon || ""}">
                        📞 Ara
                    </button>
                    <button class="small-share-button" data-ad="${eczane.ad}" data-adres="${eczane.adres || ""}">
                        ↗ Paylaş
                    </button>
                </div>
            </div>
        `;

        // Buton tıklamaları
        const callBtn = eczaneDiv.querySelector(".small-call-button");
        if (callBtn) {
            callBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                aramaYap(this.dataset.tel);
            });
        }

        const shareBtn = eczaneDiv.querySelector(".small-share-button");
        if (shareBtn) {
            shareBtn.addEventListener("click", function (e) {
                e.stopPropagation();
                eczanePaylas(this.dataset.ad, this.dataset.adres, eczane.mapsUrl);
            });
        }

        // Karta tıklandığında haritada odaklan ve bilgi penceresini ortala
        eczaneDiv.addEventListener("click", function (event) {
            if (event.target.closest("button")) return;
            eczaneyeOdaklan(eczane.ad);
        });

        fragment.appendChild(eczaneDiv);
    });

    eczaneListesi.appendChild(fragment);
    eczaneleriHaritadaGoster(eczaneler, kullaniciKonumu);
}

// ==========================================================================
// GOOGLE MAPS ENTEGRASYONU
// ==========================================================================
function initMap() {
    const varsayilanKonum = {
        lat: 40.765,
        lng: 29.94
    };

    const haritaDiv = document.getElementById("harita");
    if (!haritaDiv || typeof google === "undefined" || !google.maps) return;

    harita = new google.maps.Map(haritaDiv, {
        center: varsayilanKonum,
        zoom: 11,
        gestureHandling: "greedy"
    });

    // Eğer harita yüklenmeden önce eczane verileri geldiyse haritaya bas
    if (sonYuklenenEczaneler && sonYuklenenEczaneler.length > 0) {
        eczaneleriHaritadaGoster(sonYuklenenEczaneler, sonKullaniciKonumu);
    }
}

window.initMap = initMap;

function eczaneleriHaritadaGoster(eczaneler, kullaniciKonumu = null) {
    if (!harita || typeof google === "undefined" || !google.maps) return;

    // Önceki markerları temizle
    for (let i = 0; i < markerlar.length; i++) {
        markerlar[i].setMap(null);
    }
    markerlar = [];

    const sinirlar = new google.maps.LatLngBounds();
    let gecerliMarkerSayisi = 0;

    // Kullanıcı konumu varsa göster
    if (kullaniciKonumu && Number.isFinite(kullaniciKonumu.lat) && Number.isFinite(kullaniciKonumu.lng)) {
        const userPos = { lat: kullaniciKonumu.lat, lng: kullaniciKonumu.lng };
        const userMarker = new google.maps.Marker({
            position: userPos,
            map: harita,
            title: "Sizin Konumunuz",
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#3b82f6",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#ffffff"
            }
        });
        markerlar.push(userMarker);
        sinirlar.extend(userPos);
        gecerliMarkerSayisi++;
    }

    if (eczaneler && eczaneler.length > 0) {
        eczaneler.forEach(eczane => {
            const lat = Number(eczane.lat);
            const lng = Number(eczane.lng);

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            const pos = { lat, lng };

            const marker = new google.maps.Marker({
                position: pos,
                map: harita,
                title: eczane.ad
            });

            marker.eczaneAdi = eczane.ad;

            const temizTel = (eczane.telefon || "").replace(/\D/g, "");
            const telefonHtml = eczane.telefon
                ? `<a href="tel:${temizTel}" title="Aramak için tıklayın" style="color: #4c7f70; font-weight: 600; text-decoration: underline;">📞 ${eczane.telefon}</a>`
                : `<span style="color: #82918c;">📞 Telefon bilgisi yok</span>`;

            const bilgiPenceresi = new google.maps.InfoWindow({
                content: `
                    <div class="map-info" style="padding: 6px 2px; font-family: Arial, Helvetica, sans-serif;">
                        <h3 style="margin: 0 0 6px 0; font-size: 15px; color: #29483f; font-weight: 700;">${eczane.ad}</h3>
                        <p style="margin: 0 0 5px 0; font-size: 12px; color: #536d65; line-height: 1.4;">📍 ${eczane.adres || "Adres belirtilmemiş"}</p>
                        <p style="margin: 0 0 8px 0; font-size: 13px; color: #536d65;">${telefonHtml}</p>
                        <div class="map-popup-buttons ${temizTel ? '' : 'single'}">
                            ${temizTel ? `
                            <button
                                class="map-call-btn"
                                onclick="window.location.href='tel:${temizTel}'">
                                📞 Ara
                            </button>` : ''}
                            <button
                                class="map-direction-btn"
                                onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}', '_blank')">
                                📍 Yol Tarifi
                            </button>
                        </div>
                    </div>
                `
            });

            marker.bilgiPenceresi = bilgiPenceresi;

            marker.addListener("click", function () {
                bilgiPenceresi.open({
                    anchor: marker,
                    map: harita
                });
            });

            markerlar.push(marker);
            sinirlar.extend(pos);
            gecerliMarkerSayisi++;
        });
    }

    // Haritayı tüm markerları gösterecek şekilde ayarla
    if (gecerliMarkerSayisi > 1) {
        harita.fitBounds(sinirlar);
    } else if (gecerliMarkerSayisi === 1 && markerlar.length > 0) {
        harita.setCenter(markerlar[0].getPosition());
        harita.setZoom(15);
    }
}

// ==========================================================================
// SAYFA YÜKLENDİĞİNDE OTOMATİK VERİ ÇEK
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    ilceAra();
});
