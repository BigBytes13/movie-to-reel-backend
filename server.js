const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const bodyParser = require('body-parser');
const session = require('express-session');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors'); // Add CORS for API requests

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS
app.use(cors());

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create /tmp directories for uploads and segments
if (!fs.existsSync('/tmp/uploads/')) {
    fs.mkdirSync('/tmp/uploads/', { recursive: true });
}

if (!fs.existsSync('/tmp/segments/')) {
    fs.mkdirSync('/tmp/segments/', { recursive: true });
}

// Multer File Upload Configuration
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, '/tmp/uploads/');
        },
        filename: (req, file, cb) => {
            cb(null, uuidv4() + path.extname(file.originalname));
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['video/mp4', 'video/x-matroska', 'video/avi', 'video/webm'];
        allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error("Invalid file type"));
    },
    limits: { fileSize: 500 * 1024 * 1024 }
});

// Route: Homepage
app.get('/', (req, res) => {
    req.session.segmented = false;
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route: Handle Video Upload
app.post('/upload', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");

    let segmentDuration = parseInt(req.body.segmentDuration, 10);
    let storageOption = req.body.storageOption;
    let storageLocation = storageOption === "custom" ? req.body.storageLocation : '/tmp/segments/';

    // Ensure storage directory exists
    if (!fs.existsSync(storageLocation)) {
        fs.mkdirSync(storageLocation, { recursive: true });
    }

    const filePath = req.file.path;
    req.session.segmented = true;

    ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return res.status(500).send("Error reading video metadata.");

        let videoDuration = metadata.format.duration;
        let numSegments = Math.floor(videoDuration / segmentDuration);
        let segmentPromises = [];

        for (let i = 0; i < numSegments; i++) {
            let startTime = i * segmentDuration;
            let outputFile = path.join(storageLocation, `segment_${i + 1}.mp4`);

            segmentPromises.push(
                new Promise((resolve, reject) => {
                    ffmpeg(filePath)
                        .setStartTime(startTime)
                        .setDuration(segmentDuration)
                        .output(outputFile)
                        .outputOptions(['-preset fast', '-c:v libx264', '-crf 28', '-c:a aac', '-b:a 96k'])
                        .on('end', resolve)
                        .on('error', reject)
                        .run();
                })
            );
        }

        Promise.all(segmentPromises)
            .then(() => {
                fs.unlink(filePath, () => console.log("Original file deleted."));
                res.redirect(`${req.protocol}://${req.get('host')}/thank-you`);
            })
            .catch(err => res.status(500).send("Segmentation failed: " + err.message));
    });
});

// Route: Thank You Page
app.get('/thank-you', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

// Start Server
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
