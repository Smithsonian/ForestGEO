import React from 'react';
import Dropzone from './components/Dropzone';
import Navbar from './components/Navbar';
import Validate from './components/Validate';
import Browse from './components/Browse';
import Report from './components/Report';
import { BrowserRouter as Router, Route, Switch } from 'react-router-dom';

function App() {
  return (
    <Router>
      <>
        <Navbar />
        <Switch>
          <Route exact path="/">
            <Validate />
          </Route>
          <Route exact path="/browse">
            <Browse />
          </Route>
          <Route exact path="/report">
            <Report />
          </Route>
        </Switch>
      </>
    </Router>
  );
}

export default App;
