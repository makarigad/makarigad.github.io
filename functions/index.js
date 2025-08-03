const functions = require("firebase-functions");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });

admin.initializeApp();

exports.getPlantData = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const db = admin.firestore();
      const plantDataRef = db.collection("plantData");
      const snapshot = await plantDataRef.get();

      if (snapshot.empty) {
        // Send an empty array if no data is found
        res.status(200).json([]);
        return;
      }

      const data = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() });
      });

      // CHANGE IS HERE: Send the data array directly
      res.status(200).json(data);

    } catch (error) {
      console.error("Error fetching plant data:", error);
      res.status(500).send("Internal Server Error");
    }
  });
});