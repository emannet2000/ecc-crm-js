"use strict";
var ECCApplication = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // shared/application-schema.ts
  var require_application_schema = __commonJS({
    "shared/application-schema.ts"(exports, module) {
      var pathways = { "International Student": "STUDY", "Permanent Residency": "RESIDENCY", "Career Pathways": "WORK", "Direct Work Recruitment": "WORK", Tourist: "TOURIST" };
      var f = (name, label = name, type = "text", required = false) => ({ name, label, type, required });
      var groups = [
        { title: "1. Personal Information", key: "personal", fields: [f("Full Name", "Full Name", "text", true), f("Email Address", "Email Address", "email", true), f("Phone Number", "Phone Number", "tel", true), f("Citizenship", "Citizenship", "text", true)] },
        { title: "2. Address of Origin", key: "address", fields: [f("City", "City", "text", true), f("State / Province"), f("Zip / Postal Code"), f("Country", "Country", "text", true)] },
        { title: "3. Education", subtitle: "Latest Education", key: "education", fields: [f("Latest Education - Degree", "Degree"), f("Latest Education - Field of Study", "Field of Study"), f("Latest Education - University or College Name", "University / College Name"), f("Latest Education - Location", "Location"), f("Latest Education - Graduation Date", "Graduation Date", "date"), f("Latest Education - Relevant Coursework", "Relevant Coursework", "textarea")] },
        { title: "Study Pathway Information", key: "student", fields: [f("Study Pathway - Planned Country of Study", "Planned Country of Study"), f("Study Pathway - Planned Course to Study", "Planned Course to Study"), f("Study Pathway - Planned Year to Study", "Planned Year to Study")] },
        { title: "Achievements, Trainings, Vocational, Awards, Masteral", key: "training", fields: [f("Training - Name", "Training Name"), f("Training - Field of Study", "Field of Study"), f("Training - Organization Name", "Organization Name"), f("Training - Location", "Location"), f("Training - Graduation Date", "Graduation Date", "date"), f("Training - Issued Date", "Issued Date", "date"), f("Training - Expiration Date", "Expiration Date", "date")] },
        { title: "4. Work Experience", subtitle: "Present / Latest Two Years", key: "present", fields: [f("Present Work - Job Title", "Job Title"), f("Present Work - Company Name", "Company Name"), f("Present Work - Location", "Location"), f("Present Work - Start Date", "Start Date", "date"), f("Present Work - End Date or Present", "End Date or Present"), f("Present Work - Responsibilities or Achievements", "Responsibilities / Achievements", "textarea")] },
        { title: "Previous Work Experience", key: "previous", fields: [f("Previous Work - Job Title", "Job Title"), f("Previous Work - Company Name", "Company Name"), f("Previous Work - Location", "Location"), f("Previous Work - Start Date", "Start Date", "date"), f("Previous Work - End Date or Present", "End Date or Present"), f("Previous Work - Responsibilities or Achievements", "Responsibilities / Achievements", "textarea")] },
        { title: "5. Skills", key: "skills", fields: [f("Technical Skills", "Technical Skills", "textarea"), f("Soft Skills", "Soft Skills", "textarea"), f("Languages"), f("Language Test Taken", "Language Test", "test"), f("Other Language Test Name", "Other Test Name"), f("Language Test Band Score", "Band Score")] },
        { title: "6. Volunteer Experience", key: "volunteer", fields: [f("Volunteer - Role", "Role"), f("Volunteer - Organization Name", "Organization Name"), f("Volunteer - Location", "Location"), f("Volunteer - Start Date", "Start Date", "date"), f("Volunteer - End Date or Present", "End Date or Present"), f("Volunteer - Responsibilities or Achievements", "Responsibilities / Achievements", "textarea")] },
        { title: "7. References", key: "references", fields: [f("Reference - Full Name", "Full Name"), f("Reference - Relationship", "Relationship"), f("Reference - Company Name", "Company Name"), f("Reference - Phone Number", "Phone Number", "tel"), f("Reference - Email Address", "Email Address", "email")] },
        { title: "8. Declaration", key: "declaration", fields: [f("Date", "Date", "date", true), f("AGP Reference")] }
      ];
      var declaration = "I certify that the information provided in this application is true and complete to the best of my knowledge. I understand that any false statements or omissions may result in disqualification from employment or termination if already employed.";
      function visible(key, pathway) {
        const student = pathways[pathway] === "STUDY", tourist = pathways[pathway] === "TOURIST";
        return key === "student" ? student : key === "training" || key === "previous" ? !student && !tourist : key === "present" ? !student : ["skills", "volunteer"].includes(key) ? !tourist : true;
      }
      var value = { pathways, groups, visible, declaration, countries: ["Spain", "Portugal", "Canada", "Australia", "New Zealand", "Malta"] };
      module.exports = value;
    }
  });
  return require_application_schema();
})();
if(typeof module === 'object' && module.exports) module.exports = ECCApplication;
