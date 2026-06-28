const mongoose = require("mongoose");
require("dotenv").config();

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/mosaic";
const allowSeedReset = process.env.ALLOW_SEED_RESET === "true";

if (!allowSeedReset) {
  console.error("Refusing to reset category seed data without ALLOW_SEED_RESET=true.");
  console.error("Set MONGODB_URI to a local or disposable database before running this script.");
  process.exit(1);
}

mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to seed database"))
  .catch((err) => console.error("MongoDB connection error:", err));

const categorySchema = new mongoose.Schema({
  name: String,
  slug: String,
  isActive: { type: Boolean, default: true },
});

const ProductCategory = mongoose.model("productcategories", categorySchema);
const ServiceCategory = mongoose.model("servicecategories", categorySchema);
const FoodCategory = mongoose.model("foodcategories", categorySchema);

async function seed() {
  await ProductCategory.deleteMany({});
  await ServiceCategory.deleteMany({});
  await FoodCategory.deleteMany({});

  await ProductCategory.insertMany([
    { name: "Electronics", slug: "electronics" },
    { name: "Fashion", slug: "fashion" },
  ]);

  await ServiceCategory.insertMany([
    { name: "Plumbing", slug: "plumbing" },
    { name: "Home Cleaning", slug: "home-cleaning" },
  ]);

  await FoodCategory.insertMany([
    { name: "Restaurant", slug: "restaurant" },
    { name: "Bakery", slug: "bakery" },
  ]);

  console.log("Dummy categories inserted into seed database.");
  mongoose.connection.close();
}

seed();
