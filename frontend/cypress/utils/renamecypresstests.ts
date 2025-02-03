import fs from 'fs';
import path from 'path';

const TEST_DIR = path.resolve(__dirname, '../component'); // Adjust if needed

function renameTestFiles() {
  fs.readdir(TEST_DIR, (err, files) => {
    if (err) {
      console.error('Error reading test directory:', err);
      return;
    }

    files.forEach(file => {
      if (file.match(/^[a-zA-Z]+[A-Z][a-zA-Z]+\.cy\.tsx$/)) {
        // Match files like 'pageHomePage.cy.tsx'
        const oldPath = path.join(TEST_DIR, file);

        // Convert `pageHomePage.cy.tsx` → `page.homepage.cy.tsx`
        const newFileName = file.replace(/([a-z])([A-Z])/g, '$1.$2').toLowerCase();
        const newPath = path.join(TEST_DIR, newFileName);

        if (oldPath !== newPath) {
          fs.rename(oldPath, newPath, renameErr => {
            if (renameErr) {
              console.error('Error renaming file:', renameErr);
            } else {
              console.log(`Renamed: ${file} → ${newFileName}`);
            }
          });
        }
      }
    });
  });
}

// Run the rename function
renameTestFiles();
