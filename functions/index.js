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
        // Still send the correct structure, even if the array is empty
        res.status(200).json({ data: [] });
        return;
      }

      const data = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() });
      });

      // **CHANGE IS HERE**: The response is now { data: [...] }
      res.status(200).json({ data: data });

    } catch (error) {
      console.error("Error fetching plant data:", error);
      res.status(500).send({ error: "Internal Server Error" });
    }
  });
});