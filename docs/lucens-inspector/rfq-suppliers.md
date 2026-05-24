# RFQ — Lucens Inspector V1 (English, ready to send)

> Document à copier-coller dans un email aux fournisseurs OEM Alibaba (Hangzhou Micron, Shenzhen NNPO, OpticsMaker, etc.). Une seule page, technique mais lisible par un commercial chinois.

---

**Subject** : RFQ — Handheld UV-A Inspection Device with Integrated Display (custom OEM, 100 units pilot)

Hello,

We are **Lucens**, a French startup developing a handheld UV-A inspection device for the HACCP / food safety / hygiene professional market. We are looking for an **OEM partner** to manufacture our device based on your existing pistol-grip handheld platform.

We would like a **detailed quote** for the following specifications.

---

## 1. Form factor

- **Pistol-grip handheld** device (similar to HIKMICRO Pocket2 / InfiRay Tube style)
- **Integrated 7-inch touchscreen** (1024×600 minimum, 1280×720 preferred)
- Built-in **Li-ion 18650 battery slot** (removable / swappable)
- Physical **trigger button** on the grip (2-stage: half-press = focus, full press = capture)
- **2 side buttons** (+/− for sensitivity adjustment)
- **USB-C** port (charging + data)
- **IP54 minimum** (IP65 preferred for industrial / food environments)
- **Black matte finish** with our logo (silkscreen printing)

## 2. Imaging module (this is critical for our application)

- **Sony IMX678 STARVIS 2** sensor preferred (alternative: Sony IMX415)
- **4K UHD @ 30 fps** capture
- **USB UVC standard compliant** (must work with Chrome browser on Android)
- **Manual exposure / white balance / gain** accessible via UVC controls
- Fixed-focal lens **f/1.6 to f/2.0**, focused at **10-30 cm working distance**
- Optical long-pass filter at **400 nm** mounted in front of sensor (to block UV-A light)

## 3. UV-A light source (we will provide spec, you integrate it)

We will provide the LED module ourselves (**Nichia NCSU033D 800 mW @ 365 nm** or **Nichia NVSU233B 1450 mW @ 365 nm**). We need you to integrate it into the device with:

- Aluminum heat sink (LED dissipates ~1.8W thermal)
- Constant-current LED driver (350-500 mA configurable)
- Optical band-pass filter at **365 nm ±10 nm** mounted in front of LED
- LED positioned **coaxially with camera lens** (minimal parallax)
- Power on/off controlled by main system (Android app sends GPIO trigger)

## 4. Display / controller

- **Android 13+** OS
- **3 GB RAM minimum** (4 GB preferred)
- **32 GB storage minimum**
- **WiFi 6 dual-band** (2.4 + 5 GHz)
- **Bluetooth 5.0+**
- **Kiosk mode capable** : we need to lock the user into our app, no access to other apps
- Pre-installation of our PWA app (we provide the APK)

## 5. Quantity and delivery

- **Pilot order : 1 unit** (proof of concept, ~600-1000€ acceptable for proto)
- **First production run : 50 units** (target Q3 2026)
- **Series production : 100-300 units / month** thereafter
- **Delivery to France** (DDP Paris preferred, or EXW Shenzhen acceptable)

## 6. Quote needed

Please provide a detailed quote including :

1. **Per-unit cost** at MOQ 50, 100, 300 units
2. **NRE (Non-Recurring Engineering) cost** for tooling / mold modifications if any
3. **Lead time** for proto unit, pilot 50 units, series 100+ units
4. **Sample availability** (do you have a standard pistol-grip housing we can review?)
5. **Customization possibilities** : logo screen printing, color options, button layout adjustments
6. **CE marking support** : do you provide test reports or assist with certification?
7. **Warranty terms** : standard warranty on your hardware
8. **Payment terms** : T/T, L/C, Alibaba Trade Assurance?

## 7. Questions

a. Do you have an **existing thermal monocular housing** that we can adapt (replace thermal module with our UV+camera module)? If yes, can you send photos and spec sheet?

b. Can you **integrate a USB UVC 4K Sony camera** of our choice into your housing? Or do you have a recommended camera module?

c. Is there an option to integrate the **UV-A LED module** with proper heat sinking and driver in your existing assembly process?

d. What is your **minimum sample order time** to get 1 functional proto delivered to France?

---

We will compare your offer with **2 other OEM partners** and select based on : technical feasibility, lead time, per-unit cost, and quality references.

Please reply with your detailed quote and any technical questions you may have.

Best regards,

**Lucens Team**
Email : [your email]
Website : [your website]
WeChat / WhatsApp : [your contact]

---

## Annexes à joindre à l'email

- **Photo référence HIKMICRO Pocket2** (pour le form factor)
- **Photo référence InfiRay Tube** avec smartphone clipsé (pour l'idée du module optique)
- **Datasheet Nichia NCSU033D** (LED qu'on fournira) : https://led-ld.nichia.co.jp/en/product/uv_uva.html
- **Datasheet Sony IMX678** (capteur préféré) : disponible via Arducam ou e-con Systems
- **Mockup 3D du concept Lucens Inspector** (à produire en parallèle si tu veux qu'on le fasse)
