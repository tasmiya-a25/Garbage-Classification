import os
import io
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import tensorflow as tf
import keras

app = FastAPI(
    title="EcoVision AI Garbage Classifier API",
    description="Backend API serving a fine-tuned MobileNetV2 Keras model for classifying garbage.",
    version="1.0.0",
)

# Enable CORS so the React frontend can make requests from other origins (e.g. localhost:5173 or other dev ports)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve path to the keras model file (should be in the root directory)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, "fine_tuned_garbage_classifier.keras")

print(f"Loading Keras model from {MODEL_PATH}...")
try:
    model = keras.models.load_model(MODEL_PATH)
    print("Model loaded successfully!")
except Exception as e:
    print(f"Error loading model: {e}")
    raise RuntimeError(f"Could not load model from {MODEL_PATH}. Reason: {e}")

# The 6 classes in alphabetical order as trained on TrashNet
CLASSES = ["cardboard", "glass", "metal", "paper", "plastic", "trash"]


@app.get("/")
def read_root():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "classes": CLASSES,
    }


@app.post("/predict")
async def predict_garbage(image: UploadFile = File(...)):
    # 1. Validate file extension
    if not image.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail=f"File uploaded is not an image (Content-Type: {image.content_type}).",
        )

    try:
        # 2. Read image bytes
        contents = await image.read()
        pil_img = Image.open(io.BytesIO(contents))

        # 3. Preprocess image
        # Convert image to RGB (handles PNG/RGBA alpha channels and grayscale)
        if pil_img.mode != "RGB":
            pil_img = pil_img.convert("RGB")

        # Resize to 224x224 (input shape expected by the model)
        pil_img = pil_img.resize((224, 224))

        # Convert to numpy array and expand dims to (1, 224, 224, 3)
        img_array = np.array(pil_img, dtype=np.float32)
        img_array = np.expand_dims(img_array, axis=0)

        # Scale pixels from [0, 255] to [-1, 1] as expected by MobileNetV2
        preprocessed_img = tf.keras.applications.mobilenet_v2.preprocess_input(img_array)

        # 4. Perform prediction (using model(x, training=False) is fast and thread-safe)
        predictions = model(preprocessed_img, training=False)
        probabilities = predictions.numpy()[0]

        # 5. Extract results
        predicted_class_idx = int(np.argmax(probabilities))
        predicted_label = CLASSES[predicted_class_idx]
        confidence = float(probabilities[predicted_class_idx])

        # Create the probabilities dict
        probabilities_dict = {
            CLASSES[i]: float(probabilities[i]) for i in range(len(CLASSES))
        }

        # 6. Return response matching frontend contract
        return {
            "label": predicted_label,
            "confidence": confidence,
            "probabilities": probabilities_dict,
        }

    except Exception as e:
        print(f"Error during prediction: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while processing the image: {str(e)}",
        )


if __name__ == "__main__":
    import uvicorn
    # When run directly, start local development server
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)
