import React from 'react';
import Validate from './pages/Validate';
import Browse from './pages/Browse';
import Report from './pages/Report';
import Login from './components/Login';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/validate" element={<Validate />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </Router>
  );
}

export default App;
