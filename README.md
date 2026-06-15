# Neuro X Vision: Personal Health Repository

> An advanced, Zero-Trust medical data management platform featuring decoupled storage architecture, automated NLP-based anonymization, and Multimodal AI diagnostics summarization.

---

## Project Overview
In the modern digital health landscape, patients struggle with fragmented medical records and dense clinical jargon. Neuro X Vision addresses these challenges by engineering a centralized, patient-first architecture. It transitions the concept of a Personal Health Record (PHR) from a static digital filing cabinet into an active, intelligent health companion capable of securely rendering complex imaging (DICOM) and translating clinical data into actionable patient insights.

## Core Architecture & Features

* **Zero-Trust Authentication:** Implements a passwordless, cryptographic One-Time Password (OTP) flow utilizing JSON Web Tokens (JWT) for strict, multi-tenant session isolation.
* **Decoupled Storage Routing:** A dual-layer architecture where lightweight metadata is indexed in MongoDB, while heavy physical payloads (multi-slice MRI arrays, PDFs) are routed to cryptographically isolated Local Vaults.
* **Zero-Footprint DICOM Streaming:** Dynamically downsamples and mathematically normalizes 16-bit medical arrays using PyDICOM and NumPy to stream 8-bit visual data directly to the HTML5 Canvas, preventing browser memory crashes.
* **Automated Data Anonymization:** Enforces HIPAA/GDPR compliance by passing all extracted clinical text through a Natural Language Processing (NLP) pipeline (Microsoft Presidio) to detect and redact Protected Health Information (PHI) prior to cloud transmission.
* **Cognitive AI Summarization:** Injects sanitized patient data into localized prompt envelopes, querying a Multimodal AI Foundation Model to generate clean, jargon-free Markdown summaries of complex lab reports and handwritten prescriptions.

## Technology Stack

**Backend & Core Logic**
* Python 3.x / Flask
* PyDICOM & NumPy (Medical Image Processing)
* PyMuPDF (Document Parsing)
* Microsoft Presidio (NLP Entity Recognition)

**Frontend Integration**
* React.js / HTML5 Canvas
* Base64 Web Streaming

**Database & Cloud**
* MongoDB (NoSQL Document Store)
* Multimodal Foundation Model API (Cognitive Summarization)

## Local Setup & Installation

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YourUsername/Neuro-X-Vision.git](https://github.com/EddlaEdwin/Neuro-X-Vision.git)
   cd Neuro-X-Vision
