const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Serve static assets from project root
app.use(express.static(path.join(__dirname), {
  extensions: ['html', 'htm']
}));

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Makari Gad Hydroelectric app running on http://${HOST}:${PORT}`);
});
