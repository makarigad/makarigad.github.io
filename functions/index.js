const { onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

exports.getPlantData = onCall({ region: "us-central1" }, async (request) => {
  try {
    const db = getFirestore();
    const plantDataRef = db.collection("plantData");
    const snapshot = await plantDataRef.get();
    
    const data = [];
    snapshot.forEach(doc => {
      data.push({ id: doc.id, ...doc.data() });
    });

    // For onCall functions, you return the data object directly
    return { data: data };

  } catch (error) {
    console.error("Error fetching plant data:", error);
    // Throw a specific error for the client
    throw new functions.https.HttpsError('internal', 'Could not fetch plant data.');
  }
});