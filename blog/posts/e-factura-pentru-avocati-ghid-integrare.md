---
title: "e-Factura pentru avocați: ghid complet de integrare"
date: "2026-09-10"
slug: "e-factura-pentru-avocati-ghid-integrare"
description: "Ghid practic e-Factura pentru cabinete de avocatură: configurare SPV, certificat digital calificat, automatizarea facturării și conformitate ANAF."
read_time: 14
categories: ["digitalizare", "management", "automatizări"]
tags: ["e-factura", "avocați", "anaf", "facturare", "digitalizare", "management"]
---

Dacă administrezi un cabinet individual, un cabinet asociat sau o societate civilă profesională de avocați, sistemul național RO e-Factura nu mai reprezintă doar un subiect de dezbatere legislativă, ci o componentă zilnică a fluxului tău de lucru. Transmiterea electronică a facturilor către clienți persoane juridice (B2B) și persoane fizice (B2C) impune o sincronizare precisă între evidența orelor lucrate, redactarea onorariilor și platforma Agenției Naționale de Administrare Fiscală (ANAF).

Acest ghid tehnic și operațional îți explică pas cu pas cum să configurezi infrastructura digitală a cabinetului, cum să eviți amenzile fiscale și cum să transformi o constrângere legislativă într-un mecanism automatizat de încasare.

<div class="row justify-content-center my-4">
  <div class="col-md-9">
    <img src="../../assets/img/undraw_time-management_fedt.png" alt="Ilustrație: e-Factura pentru avocați: ghid complet de integrare în practica judiciară modernă" class="img-fluid rounded shadow-sm" loading="lazy" decoding="async" />
  </div>
</div>

---

## 1. Cadrul legal e-Factura aplicabil formelor de exercitare a profesiei

Formele de exercitare a profesiei de avocat reglementate de Legea nr. 51/1995 - cabinete individuale (CI), cabinete asociate (CA), societăți civile profesionale (SCP) sau societăți profesionale cu răspundere limitată (SPRL) - intră sub incidența Ordonanței de Urgență a Guvernului nr. 120/2021 și a reglementărilor fiscale subsecvente privind sistemul național RO e-Factura.

Fiecare formă de organizare are un regim specific de identificare fiscală:
- **Cabinetul Individual de Avocat (CIA)** operează pe baza Codului de Identificare Fiscală (CIF) emis de organul fiscal competent teritorial, distinct de Codul Numeric Personal (CNP) al titularului. Facturarea se realizează exclusiv pe acest CIF profesional.
- **Societățile profesionale (SCP / SPRL)** dețin cod de înregistrare fiscală specific entităților profesionale cu sau fără personalitate juridică.

Conform calendarului fiscal consolidat:
1. În relația **B2B (Business-to-Business)**, toate facturile emise către societăți comerciale, bănci, companii de asigurări sau instituții publice trebuie transmise exclusiv prin SPV în format standardizat XML UBL 2.1 în termen strict de maximum 5 zile calendaristice de la data emiterii.

2. În relația **B2C (Business-to-Consumer)**, facturile emise către clienți persoane fizice (asistență juridică în litigii civile, cauze penale, partaje, consultanță succesorală) sunt de asemenea cuprinse în sistemul obligatoriu, existând proceduri clare pentru respectarea secretului profesional în redactarea liniilor de factură.

Nerespectarea termenului legal de 5 zile atrage sancțiuni contravenționale diferențiate în funcție de mărimea contribuabilului. Pentru profesiile liberale asimilate micilor contribuabili, amenzile pot atinge sume considerabile per factură netransmisă la termen.

Înțelegerea riguroasă a acestor cerințe te ajută să elimini riscul oricărei sancțiuni administrative.

---

## 2. Certificatul digital calificat: alegere, instalare și token criptografic

Accesul la Spațiul Privat Virtual și autorizarea transmiterilor electronice impun deținerea unui **certificat digital calificat pentru semnătură electronică avansată sau calificată**, eliberat de un prestator de servicii de încredere acreditat conform Regulamentului UE eIDAS (nr. 910/2014).

Când selectezi dispozitivul criptografic pentru cabinet, analizează atent cele două opțiuni tehnice:

| Criteriu de selecție | Token fizic USB (Hardware PKI) | Certificat calificat în Cloud (Remote HSM) |
|:--- |:--- |:--- |
| **Mobilitate și acces** | Necesită port USB fizic și instalare de drivere locale | Funcționează de pe orice laptop, tabletă sau telefon mobil |
| **Integrare software** | Greu de conectat direct la servicii web automate | Ideal pentru conectare prin protocoale OAuth2 și API-uri |
| **Multi-utilizator** | Poate fi folosit doar de persoana care deține token-ul | Permite autorizări controlate pentru asistenți sau contabil |
| **Compatibilitate macOS/Windows** | Necesită middleware suplimentar pe calculatoare macOS | Complet independent de sistemul de operare |
| **Risc de pierdere fizică** | Risc ridicat de deteriorare mecanică sau rătăcire | Nul (securizat în module hardware HSM certificate FIPS) |

Pentru un avocat pledant care își desfășoară activitatea între instanțe, sediul clienților și birou, certificatul în cloud este de departe soluția cea mai agilă. Autentificarea se realizează prin notificări push sau coduri OTP generate instant pe smartphone. Dacă optezi pentru token fizic USB, instalează din start aplicațiile de administrare a dispozitivului (cum ar fi SafeNet Authentication Client) cu drepturi de administrator și testează vizibilitatea cheii private în browser.

Pentru detalii aprofundate despre securizarea infrastructurii informatice din cabinet, parcurge ghidul nostru [Zero Trust Security explicat pentru avocați](../zero-trust-security-explicat-pentru-avocati/).

---

## 3. Înrolarea cabinetului în Spațiul Privat Virtual (SPV ANAF)

Înregistrarea formularului `C800` sau `C150` pe portalul ANAF reprezintă etapa tehnică prealabilă emiterii oricărei facturi electronice. Procedura leagă certificatul digital calificat de codul fiscal profesional al cabinetului:

1. **Descărcarea documentului de confirmare:** Intră pe pagina prestatorului de semnătură digitală, generează fișierul `document_confirmare.pdf` și semnează-l electronic cu certificatul tău proaspăt activat.
2. **Contrasemnarea de către furnizor:** Transmite fișierul pe portalul prestatorului pentru verificare. În câteva minute primești documentul contrasemnat cu sigiliul electronic al autorității de certificare.
3. **Depunerea cererii pe portalul ANAF:** Deschide portalul web ANAF, accesează meniul **Servicii Online** -> **Înregistrare utilizatori** -> **Înregistrare cu certificat digital**. Încarcă documentul de confirmare semnat și anexează arhiva cu actele doveditoare:
 - Decizia Baroului privind dobândirea calității de avocat definitiv și înființarea formei de exercitare;
 - Certificatul de înregistrare fiscală (CIF) al cabinetului;
 - Actul de identitate al avocatului titular;
 - Împuternicire notarială sau mandat special dacă cererea este depusă pentru o societate profesională cu mai mulți asociați.
4. **Validarea recipisei de acces:** În mod obișnuit, în termen de 24 până la 48 de ore vei primi prin e-mail recipisa de confirmare.

După aprobare, conectează-te pe portalul ANAF, mergi în modulul **Factura electronică** -> **RO e-Factura** și efectuează un prim test de navigare pentru a verifica dacă CIF-ul cabinetului este vizibil în meniul derulant al entităților reprezentate.

---

## 4. Structura fișierului XML UBL 2.1 și particularitățile onorariilor avocațiale

Platforma RO e-Factura procesează exclusiv fișiere structurate XML construite pe sintaxa **UBL 2.1 (Universal Business Language)**, urmând specificația tehnică europeană SR EN 16931-1 adaptată la nivel național prin standardul CIUS-RO.

Facturile emise de un avocat prezintă câteva elemente particulare indispensabile:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
    <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
    <cbc:ID>AV-2026-0089</cbc:ID>
    <cbc:IssueDate>2026-09-10</cbc:IssueDate>
    <cbc:DueDate>2026-09-25</cbc:DueDate>
    <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
    
    <!-- Referință Contract Asistență Juridică -->
    <cac:ContractDocumentReference>
        <cbc:ID>CAJ nr. 312/2026</cbc:ID>
    </cac:ContractDocumentReference>

    <!-- Datele Cabinetului de Avocat (Furnizor) -->
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyName>
                <cbc:Name>Cabinet de Avocat Ionescu Dan</cbc:Name>
            </cac:PartyName>
            <cac:PostalAddress>
                <cbc:StreetName>Strada Academiei nr. 28</cbc:StreetName>
                <cbc:CityName>București</cbc:CityName>
                <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>RO24681357</cbc:CompanyID>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:PartyTaxScheme>
        </cac:Party>
    </cac:AccountingSupplierParty>
    
    <!-- Linie factură onorariu avocat -->
    <cac:InvoiceLine>
        <cbc:ID>1</cbc:ID>
        <cbc:InvoicedQuantity unitCode="HUR">10.00</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="RON">6000.00</cbc:LineExtensionAmount>
        <cac:Item>
            <cbc:Name>Asistență și reprezentare juridică conform CAJ 312/2026</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>19</cbc:Percent>
                <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="RON">600.00</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>
</Invoice>
```

Câteva recomandări tehnice legate de aceste câmpuri:
- **Unitatea de măsură (`unitCode`):** Când facturezi pe bază de oră, folosește codul `HUR`. Dacă onorariul este forfetar pe dosar sau abonament lunar fix, se folosește de regulă codul `C62` (unități) sau `H87` (bucată).
- **Tratamentul TVA (`ClassifiedTaxCategory`):** Dacă cabinetul tău este înregistrat în scopuri de TVA, folosești codul `S` (cotă standard 19%). Dacă ești neplătitor de TVA conform regimului special de scutire pentru mici întreprinderi (art. 310 Cod Fiscal), codul folosit este `E` (Exempt) completat cu motivul specific de scutire.

---

## 5. De la factură proformă la transmiterea automată în SPV

În practica avocațială, emiterea facturilor proforme sau a notelor informative de plată este o rutină frecventă pentru asigurarea încasării avansului înainte de inițierea acțiunilor judiciare. Totuși, din punct de vedere legislativ, proforma este un simplu document intern de informare și nu se încarcă niciodată în SPV ANAF.

Iată traseul corect și securizat pentru gestionarea documentelor contabile:

```
[Încheiere Contract Asistență Juridică]
                  ↓
[Generare Proformă / Notă de Onorariu]
                  ↓
[Încasare onorariu în cont curent sau cont fiduciar]
                  ↓
[Emitere Factură Fiscală Definitivă]
                  ↓
[Conversie instantă în XML UBL 2.1 & Validare Schematron]
                  ↓
[Transmitere securizată în SPV ANAF via API]
                  ↓
[Recepționare index încărcare și descărcare recipisă semnată]
```

Pentru a elimina riscul întârzierilor peste limita de 5 zile, cabinetele digitalizate conectează aplicația de facturare direct cu fluxul bancar prin protocoalelor de Open Banking. În momentul în care plata clientului este recepționată, sistemul generează factura finală și trimite pachetul XML către serverele fiscale fără să fie nevoie de o tastare manuală.

Pentru o evaluare a orelor irosite pe astfel de proceduri manuale repetitive, citește articolul nostru [Cât te costă, de fapt, un cabinet de avocatură nedigitalizat?](../cat-te-costa-de-fapt-un-cabinet-de-avocatura-nedigitalizat/).

---

## 6. Gestiunea mesajelor de stare, a erorilor de validare și a indexului de descărcare

O neînțelegere frecventă este convingerea că apăsarea butonului de trimitere din aplicația de facturare reprezintă finalul obligației fiscale. În realitate, serverele Ministerului Finanțelor parcurg mai mulți pași asincroni:

1. **Starea `in prelucrare`:** Fișierul a ajuns pe server și a primit un index unic de încărcare. Factura nu este considerată validată legal în această etapă.
2. **Starea `eroare`:** Validatorul Schematron al ANAF a identificat neconcordanțe structurale sau semantice. Factura este considerată **netransmisă**, iar termenul de conformare de 5 zile continuă să curgă fără întrerupere.
3. **Starea `ok`:** Fișierul este validat complet. Sistemul fiscal generează o arhivă ZIP protejată, ce conține fișierul XML original și fișierul de semnătură digitală al Ministerului Finanțelor.

<div class="row justify-content-center my-4">
  <div class="col-md-9">
    <img src="../../assets/img/undraw_add-information_06qr.png" alt="Ilustrație: flux operațional și măsuri practice pentru e-Factura pentru avocați: ghid complet de integrare" class="img-fluid rounded shadow-sm" loading="lazy" decoding="async" />
  </div>
</div>

### Cele mai întâlnite trei erori de validare și remedierea lor:

- **Eroarea `BR-CO-10 (Diferență între TVA total și suma TVA pe linii)`:** Apare frecvent la calculul onorariilor orare fracționate. Remediere: configurează programul de facturare să opereze cu cel puțin 4 zecimale pentru cantitatea de ore și să efectueze rotunjirea exclusiv la nivelul totalului liniei.
- **Eroarea `Cod fiscal client incorect`:** Survine în special la clienți nerezidenți persoane fizice sau societăți străine fără cod fiscal românesc. Remediere: aplică prefixul de țară corespunzător și folosește identificatorii fiscali recunoscuți internațional conform specificațiilor tehnice ANAF.
- **Eroarea `Lipsă cod administrativ teritorial (județ)`:** Adresa de facturare trebuie să includă obligatoriu codul de județ standardizat ISO (de exemplu `RO-B` pentru Municipiul București sau `RO-CJ` pentru județul Cluj).

---

## 7. Integrarea e-Factura cu softul de gestiune a dosarelor și contabilitate

Dacă folosești o aplicație modernă de gestiune a activității juridice (LPM - Legal Practice Management), conectarea acesteia direct la sistemul de facturare elimină complet munca de reintrodus date de pe un ecran pe altul.

Pentru o analiză completă privind modernizarea instrumentelor digitale din cabinet, explorează ghidul [Digitalizarea cabinetului individual de avocat: ghid integral](../digitalizarea-cabinetului-individual-de-avocat/).

O arhitectură integrată presupune:
- **Sincronizarea automată a dosarului:** La deschiderea unui dosar nou, datele de identificare ale clientului sunt validate direct prin interogarea bazei de date ANAF/VIES și asociate cu contractul de asistență.
- **Transformarea pontajelor în facturi:** Orele înregistrate de avocații asociați sau colaboratori sunt grupate automat pe proiecte, aprobate de titular și convertite printr-un singur clic în linii de factură fiscală.

- **Accesul în timp real al contabilului:** Contabilul cabinetului primește acces direct la pachetele ZIP descărcate din SPV, eliminând schimbul nesfârșit de e-mailuri și tabele Excel la final de lună.

---

## 8. Tratamentul cheltuielilor refacturate, taxelor de timbru și sumelor din fiducie

În activitatea practică, avocații avansează sume substanțiale pentru clienții lor: taxe judiciare de timbru, onorarii de expertiză judiciară, taxe notariale sau cheltuieli de executare silită.

Modul în care aceste sume sunt tratate în e-Factura cere o atenție deosebită:

1. **Cheltuielile avansate în numele și pe seama clientului (decont):**
 Conform dispozițiilor art. 286 alin. (4) lit. e) din Codul Fiscal, sumele achitate de avocat în numele și pe seama clientului și care se decontează acestuia nu fac parte din baza de impozitare a TVA. Pentru a fi transpuse corect în fișierul XML UBL 2.1, aceste sume se introduc pe o linie distinctă de factură având categoria de taxare adecvată operațiunilor scutite sau în afara ariei de aplicare a TVA, însoțite obligatoriu de referința chitanței sau ordinului de plată emis inițial pe numele clientului.
2. **Onorariile și garanțiile depuse în contul fiduciar:**
 Sumele primite în contul fiduciar deschis conform Statutului profesiei de avocat nu reprezintă venituri ale cabinetului la momentul încasării, ci fonduri deținute cu titlu de depozit. Factura fiscală și transmiterea în e-Factura intervin exclusiv la data la care onorariul devine cert, lichid și exigibil conform contractului (de exemplu la livrarea opiniei juridice sau pronunțarea soluției judecătorești).

---

## 9. Protecția datelor (GDPR) și secretul profesional în descrierea serviciilor din factură

Secretul profesional, consfințit de art. 11 din Legea nr. 51/1995, este absolut și nu poate fi restrâns de nicio dispoziție administrativă. Și Regulamentul General privind Protecția Datelor (GDPR) instituie obligația strictă a minimizării datelor.

Deoarece fișierele XML din sistemul e-Factura sunt arhivate pe serverele administrației fiscale și pot fi vizualizate de diverși funcționari sau auditori, **evită introducerea detaliilor confidențiale în denumirea serviciilor prestate**:
- Nu menționa numele părților adverse în cauze de dreptul familiei, partaj sau litigii penale;
- Nu detalia strategii procesuale, suspiciuni de fraudă sau elemente din dosare sensibile;
- Nu include date medicale sau de stare civilă în descrierea onorariului.

### Exemple concrete de redactare conformă:

- **Formulare de evitat:** *„Redactare plângere penală împotriva numitului AB pentru delapidare în dosarul de urmărire penală nr. 123/P/2026”*
- **Formulare conformă și sigură:** *„Servicii de asistență și reprezentare juridică conform Contractului de Asistență Juridică nr. 88/2026”*

Pentru securizarea fluxului de semnare a contractelor și împuternicirilor cu clienții la distanță, citește recomandările practice din [Cum să folosești DocuSign ca avocat](../cum-sa-folosesti-docusign-ca-avocat/).

---

## 10. Automatizarea fluxurilor cu API ANAF și webhook-uri

Cabinetele care gestionează un volum constant de facturi pot abandona complet încărcarea manuală prin browser. Sistemul informatic al Ministerului Finanțelor oferă o interfață programatică securizată prin protocolul **OAuth 2.0**.

Iată pașii tehnici pentru o integrare automată fără cusur:

```
[Aplicație Cabinet / ERP Juridic]
             │
             ├── 1. POST https://logincert.anaf.ro/anaf-oauth2/v1/token
             │      (Autentificare pe bază de certificat calificat)
             │
             ├── 2. POST https://api.anaf.ro/prod/FMaster-Net/rest/upload?standard=UBL&cif={CIF}
             │      (Încărcare XML semnat în sistem)
             │      <-- Răspuns: {"execution_id": "40918231"}
             │
             ├── 3. GET https://api.anaf.ro/prod/FMaster-Net/rest/stareMesaj?id_incarcare=40918231
             │      (Verificare automată periodică a stării)
             │      <-- Răspuns: {"stare": "ok", "id_descarcare": "8021934"}
             │
             └── 4. GET https://api.anaf.ro/prod/FMaster-Net/rest/descarcare?id=8021934
                    (Descărcare arhivă ZIP cu sigiliu de stat)
```

Prin configurarea acestui pipeline automat:
1. Token-ul de autorizare se reîmprospătează la fiecare 90 de zile automat.
2. Facturile generate pe parcursul zilei sunt trimise în loturi nocturne sau instant la emitere.
3. Sistemul monitorizează starea de procesare la intervale calibrate pentru a respecta politica de limitare a apelurilor API (rate limiting) impusă de serverele guvernamentale.

4. Recipisa semnată este atașată automat în dosarul electronic al clientului, iar orice notificare de eroare trimite instant o alertă internă pe canalul de asistență tehnică al cabinetului.

---

## 11. Arhivarea electronică pe 5/10 ani și conformitatea cu normele fiscale

Conform legislației fiscale naționale, documentele justificative contabile trebuie păstrate pentru o perioadă de 5 ani (în cazul cabinetelor individuale ce țin contabilitate în partidă simplă) sau 10 ani (în cazul societăților profesionale).

Ce presupune arhivarea legală în contextul e-Factura?
- **Fișierul PDF nu este factura originală:** Chiar dacă software-ul tău generează un fișier PDF plăcut vizual pentru client, din perspectivă legală **singurul document recunoscut ca original fiscal este fișierul XML însoțit de semnătura digitală a Ministerului Finanțelor**, cuprins în arhiva ZIP descărcată din SPV.
- **Integritatea arhivelor:** Orice modificare a numelui fișierelor sau a conținutului din arhivă anulează validitatea sigiliului electronic.

- **Strategia de siguranță 3-2-1:** Păstrează cel puțin trei copii ale fiecărui pachet de arhivare, pe două suporturi fizice diferite (de exemplu SSD local de birou și server NAS criptat), dintre care una într-un depozit securizat de stocare în cloud cu backup automatizat.

---

## 12. Checklist operațional pentru auditul facturării electronice în cabinet

Pentru a menține cabinetul ferit de riscuri fiscale și erori procedurale, parcurge periodic următoarea listă de control operațional:

| Etapă verificare | Obiectiv operațional | Persoană responsabilă | Frecvență |
|:--- |:--- |:--- |:--- |
| **1. Valabilitate certificat** | Monitorizarea termenului de expirare a semnăturii electronice calificate | Titular / Responsabil IT | Lunar |
| **2. Verificare coduri fiscale** | Validarea CIF/CUI pentru toți clienții noi prin registrul public VIES/ANAF | Secretariat | La deschidere contract |
| **3. Termen de transmitere** | Asigurarea că nicio factură nu depășește limita legală de 5 zile | Avocat coordonator | Săptămânal |
| **4. Validare recipise** | Verificarea existenței recipiselor cu starea `ok` pentru toate trimiterile | Departamentul contabilitate | Săptămânal |
| **5. Filtru secret profesional** | Verificarea descrierilor facturate pentru a nu conține date confidențiale | Avocat de caz | La fiecare emitere |
| **6. Deconturi justificate** | Ataşarea documentelor de timbru judiciar la dosarele cu cheltuieli decontate | Avocat / Stagiar | La fiecare decont |
| **7. Arhivare criptată** | Sincronizarea arhivelor ZIP semnate în spațiul securizat de backup | Responsabil IT | Zilnic automat |

Parcurgerea sistematică a acestor pași garantează că activitatea cabinetului respectă cele mai exigente standarde de conformitate, eliminând stresul controalelor inopinate.

---

## Concluzie: De la obligație birocratică la eficiență operațională

Sistemul e-Factura a fost perceput inițial ca o povară administrativă suplimentară pentru profesiile liberale. În realitate, cabinetul care adoptă digitalizarea completă a acestui proces obține avantaje substanțiale: facturi emise instant din pontaje, trasabilitate exactă a stadiului de plată, reducerea erorilor contabile și eliminarea definitivă a dosarelor de hârtie cu facturi rătăcite.

Tranziția necesită însă o curbă de învățare și o configurare tehnică riguroasă, în special pentru alegerea certificatului digital, setarea filtrelor GDPR pentru secretul profesional și automatizarea comunicării cu SPV.

Dacă dorești să implementezi e-Factura și fluxuri automatizate de facturare pentru cabinetul tău, adaptat specificului practicii și echipei tale, echipa **SOLON** oferă consultanță de digitalizare și dezvoltare dedicată profesioniștilor din domeniul juridic.

---

> *Prezentul articol are un caracter pur informativ și educațional și nu constituie consultanță juridică în sensul Legii nr. 51/1995. Pentru asistență personalizată, vă recomandăm consultarea unui avocat specializat.*

<!-- AI-Assisted Content | Verified by SOLON Editorial | Model: Gemini / Claude | Compliance: EU AI Act Art. 50 -->
