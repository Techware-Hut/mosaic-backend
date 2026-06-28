const mongoose = require("mongoose");
const Business = require("../models/Business"); // Adjust path to your Business model

// Local-only dummy data. Do not point this script at production data.

// Import ObjectId from mongoose.Types
const { ObjectId } = mongoose.Types;

async function insertDummyData() {
  const data = [
    {
      owner: new ObjectId("688df1f393c70d3c8f8b32f5"), // Use `new ObjectId()` here
      businessName: "Business A",
      slug: "business-a",
      description: "Description for Business A",
      logo: "logo_a.png",
      coverImage: "cover_a.jpg",
      website: "https://www.business-a.com",
      email: "contact@business-a.com",
      minorityType: new ObjectId("60b7c5e5c9d6c8a053d5e9ea"), // Use `new ObjectId()` here
      phone: "+1234567890",
      address: {
        street: "123 Business St",
        city: "Business City",
        state: "Business State",
        zipCode: "12345",
        country: "Country A"
      },
      socialLinks: {
        facebook: "https://facebook.com/business-a",
        instagram: "https://instagram.com/business-a",
        twitter: "https://twitter.com/business-a",
        linkedin: "https://linkedin.com/company/business-a"
      },
      listingType: "product",
      productCategories: [
        new ObjectId("60b7c5e5c9d6c8a053d5e9eb"), // Use `new ObjectId()` here
      ],
      serviceCategories: [],
      foodCategories: [],
      isApproved: false,
      isActive: false,
      subscriptionId: new ObjectId("60b7c5e5c9d6c8a053d5e9ec"), // Use `new ObjectId()` here
      stripeSubscriptionId: "stripe_sub_id_1"
    },
    {
      owner: new ObjectId("688df1f393c70d3c8f8b32f5"),
      businessName: "Business B",
      slug: "business-b",
      description: "Description for Business B",
      logo: "logo_b.png",
      coverImage: "cover_b.jpg",
      website: "https://www.business-b.com",
      email: "contact@business-b.com",
      minorityType: new ObjectId("60b7c5e5c9d6c8a053d5e9ea"),
      phone: "+1234567891",
      address: {
        street: "456 Business St",
        city: "Business City",
        state: "Business State",
        zipCode: "12346",
        country: "Country B"
      },
      socialLinks: {
        facebook: "https://facebook.com/business-b",
        instagram: "https://instagram.com/business-b",
        twitter: "https://twitter.com/business-b",
        linkedin: "https://linkedin.com/company/business-b"
      },
      listingType: "service",
      productCategories: [],
      serviceCategories: [
        new ObjectId("60b7c5e5c9d6c8a053d5e9ed"), // Use `new ObjectId()` here
      ],
      foodCategories: [],
      isApproved: false,
      isActive: false,
      subscriptionId: new ObjectId("60b7c5e5c9d6c8a053d5e9ec"),
      stripeSubscriptionId: "stripe_sub_id_2"
    },
    {
      owner: new ObjectId("688df1f393c70d3c8f8b32f5"),
      businessName: "Business C",
      slug: "business-c",
      description: "Description for Business C",
      logo: "logo_c.png",
      coverImage: "cover_c.jpg",
      website: "https://www.business-c.com",
      email: "contact@business-c.com",
      minorityType: new ObjectId("60b7c5e5c9d6c8a053d5e9ea"),
      phone: "+1234567892",
      address: {
        street: "789 Business St",
        city: "Business City",
        state: "Business State",
        zipCode: "12347",
        country: "Country C"
      },
      socialLinks: {
        facebook: "https://facebook.com/business-c",
        instagram: "https://instagram.com/business-c",
        twitter: "https://twitter.com/business-c",
        linkedin: "https://linkedin.com/company/business-c"
      },
      listingType: "food",
      productCategories: [],
      serviceCategories: [],
      foodCategories: [
        new ObjectId("60b7c5e5c9d6c8a053d5e9ef"), // Use `new ObjectId()` here
      ],
      isApproved: false,
      isActive: false,
      subscriptionId: new ObjectId("60b7c5e5c9d6c8a053d5e9ec"),
      stripeSubscriptionId: "stripe_sub_id_3"
    },
    {
      owner: new ObjectId("688df1f393c70d3c8f8b32f5"),
      businessName: "Business D",
      slug: "business-d",
      description: "Description for Business D",
      logo: "logo_d.png",
      coverImage: "cover_d.jpg",
      website: "https://www.business-d.com",
      email: "contact@business-d.com",
      minorityType: new ObjectId("60b7c5e5c9d6c8a053d5e9ea"),
      phone: "+1234567893",
      address: {
        street: "101 Business St",
        city: "Business City",
        state: "Business State",
        zipCode: "12348",
        country: "Country D"
      },
      socialLinks: {
        facebook: "https://facebook.com/business-d",
        instagram: "https://instagram.com/business-d",
        twitter: "https://twitter.com/business-d",
        linkedin: "https://linkedin.com/company/business-d"
      },
      listingType: "product",
      productCategories: [
        new ObjectId("60b7c5e5c9d6c8a053d5e9eb"), // Use `new ObjectId()` here
      ],
      serviceCategories: [],
      foodCategories: [],
      isApproved: false,
      isActive: false,
      subscriptionId: new ObjectId("60b7c5e5c9d6c8a053d5e9ec"),
      stripeSubscriptionId: "stripe_sub_id_4"
    },
    {
      owner: new ObjectId("688df1f393c70d3c8f8b32f5"),
      businessName: "Business E",
      slug: "business-e",
      description: "Description for Business E",
      logo: "logo_e.png",
      coverImage: "cover_e.jpg",
      website: "https://www.business-e.com",
      email: "contact@business-e.com",
      minorityType: new ObjectId("60b7c5e5c9d6c8a053d5e9ea"),
      phone: "+1234567894",
      address: {
        street: "202 Business St",
        city: "Business City",
        state: "Business State",
        zipCode: "12349",
        country: "Country E"
      },
      socialLinks: {
        facebook: "https://facebook.com/business-e",
        instagram: "https://instagram.com/business-e",
        twitter: "https://twitter.com/business-e",
        linkedin: "https://linkedin.com/company/business-e"
      },
      listingType: "service",
      productCategories: [],
      serviceCategories: [
        new ObjectId("60b7c5e5c9d6c8a053d5e9ed"), // Use `new ObjectId()` here
      ],
      foodCategories: [],
      isApproved: false,
      isActive: false,
      subscriptionId: new ObjectId("60b7c5e5c9d6c8a053d5e9ec"),
      stripeSubscriptionId: "stripe_sub_id_5"
    }
  ];

  try {
    await mongoose.connect("mongodb://localhost:27017/mosaic", { useNewUrlParser: true, useUnifiedTopology: true });

    // Insert the data
    await Business.insertMany(data);
    console.log("Dummy data inserted successfully!");

    mongoose.disconnect();
  } catch (error) {
    console.error("Error inserting data:", error);
    mongoose.disconnect();
  }
}

insertDummyData();
