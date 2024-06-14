"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionGroup,
  AccordionSummary,
  Box,
  IconButton,
  List,
  ListItem,
  Tooltip,
  Typography
} from "@mui/joy";
import WarningIcon from '@mui/icons-material/Warning';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from "@mui/joy/Avatar";
import { CensusLogo, PlotLogo } from "@/components/icons";
import { useOrgCensusContext, usePlotContext, useSiteContext } from "@/app/contexts/userselectionprovider";

export default function DashboardPage() {

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const attributeNote = "NOTE: If a code can be used for more than one status (e.g. The code “L” for a leaning tree, could\n" +
    "apply to either a dead or alive stem), or if a code does not indicate any of the above status\n" +
    "options, the status column should be left blank.";
  const quadratNote = "NOTE: The x and y coordinates (“startx” and “starty”) refer to the distance in meters between\n" +
    "the quadrat under question and lowest, left-most corner of the entire plot (or\n" +
    "wherever your plot origin, or 0,0 coordinates are).";
  const censusNote1 = "NOTE: Each of the multiple stems should be included in these files. You may indicate in the codes\n" +
    "field which one is the main stem (if the tree has only one stem, you do not have to include the main\n" +
    "stem code). The rest of the information should be repeated for each multiple stem. Make sure that\n" +
    "the information (species code, date, etc.) is exactly the same for all multiple stems of the same tree. ";
  const censusNote2 = "NOTE: The dataset for each census should only contain trees and stems that were tagged and\n" +
    "measured from that census. The dataset for subsequent censuses should contain all live stems from\n" +
    "the previous census. Dead or lost stems should have the appropriate codes to indicate their absence\n" +
    "in subsequent censuses.";
  return (
    <Box sx={{ display: 'flex', flexGrow: 1, width: '85%', flexDirection: 'column', marginBottom: 5 }}>
      <Typography level={"body-lg"} sx={{ paddingBottom: '1em' }}>Please use this guide to navigate through this
        app&apos;s key features and functionalities.</Typography>
      <Typography level="h3">Understanding the Sidebar</Typography>
      <Typography level="body-lg" sx={{ paddingBottom: '1em' }}>
        The sidebar is intended to provide you with quick and easy access to the different features this app provides.
        <Tooltip title="Please note that some features are still in progress and may not be usable at this time.">
          <IconButton>
            <WarningIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Typography>
      <AccordionGroup sx={{ paddingBottom: '2em' }}>
        <Accordion>
          <AccordionSummary>
            <Box sx={{ alignItems: 'center', flexDirection: 'row', display: 'flex' }}>
              <Avatar color={"primary"}>
                <TravelExploreIcon />
              </Avatar>
              <Typography level={"title-lg"}>Select a Site</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"}>
              Now that you have logged in, you will see the sidebar is currently empty, with the exception of a
              clickable
              button saying &quot;Select Site&quot;<br />
              In order to fully access the website, you must select the site you are currently working in.
              <Tooltip color={"warning"} title={"Please contact an administrator if you cannot access the site\n" +
                "          you are working on."}>
                <IconButton>
                  <WarningIcon fontSize={"small"} />
                </IconButton>
              </Tooltip><br />
              Once you have selected a site, you should see a second menu option slide out to enable you to select a
              plot.
            </Typography>
          </AccordionDetails>
        </Accordion>
        {currentSite !== undefined && (
          <Accordion>
            <AccordionSummary>
              <Box sx={{ alignItems: 'center', flexDirection: 'row', display: 'flex' }}>
                <Avatar color={"primary"}>
                  <PlotLogo />
                </Avatar>
                <Typography level={"title-lg"}>Select a Plot</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Typography level={"body-lg"}>
                Following the same format as the Site, clicking on the Select Plot link will open a dialog box to allow
                you to select a plot.
                <br />
                After selecting a plot, you will see the navigation menu appear along with the census selection box.
                However, it will remain disabled until you select a census!
                <Tooltip color={"warning"} title={"Please contact an administrator if you cannot access the plot\n" +
                  "          you are working on."}>
                  <IconButton>
                    <WarningIcon fontSize={"small"} />
                  </IconButton>
                </Tooltip>
              </Typography>
            </AccordionDetails>
          </Accordion>
        )}
        {currentSite !== undefined && currentPlot !== undefined && (
          <Accordion>
            <AccordionSummary>
              <Box sx={{ alignItems: 'center', flexDirection: 'row', display: 'flex' }}>
                <Avatar color={"primary"}>
                  <CensusLogo />
                </Avatar>
                <Typography level={"title-lg"}>Select a Census</Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Typography level={"body-lg"}>
                Censuses are organized by Plot Census Number!<br />
                Within each plot census number, you can create any number of date ranges, which are then associated with an internal census ID. <br />
                Please note -- when you are uploading or adding information, it will be added to the nearest OPEN census. <br />
                <b>You can only add information to an OPENED census!</b> <br />
                <b>You can only have one open census at a time!</b> <br />
                Please note: <br />
                Censuses cannot be updated or deleted. If you need to add revising information, please start a new census, add the respective information,
                and close that census to add it to the overall plot census category. <br />
                Please use the Reopen/Close census to add or close new date ranges to the existing Plot Census Number. <br />
                Please use the Start New Census button to create a new Plot Census Number, or an entirely new census.
              </Typography>
            </AccordionDetails>
          </Accordion>
        )}
      </AccordionGroup>
      {currentSite !== undefined && currentPlot !== undefined && currentCensus !== undefined && (
        <>
          <Typography level="h3" sx={{ paddingBottom: '1em' }}>Navigating Through the Website</Typography>
          <AccordionGroup sx={{ paddingBottom: '2em' }}>
            <Accordion>
              <AccordionSummary>
                <Typography level={"title-lg"} sx={{ paddingBottom: '1em' }}>Understanding the Site System</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography level={"body-lg"}>
                  When you first log in and select a site, plot, and census, you will see a series of loading screens appear. <br />
                  If you are starting a new census, you will see that the View Measurements button is disabled with a warning badge,
                  and that one or more of the Supporting Data Views menu links have a red danger badge attached. <br />
                  This is the <b>Prevalidation</b> system. You must populate all of the tables that have a red badge in order to be able to add measurements. <br />
                  You will also see a button in the bottom left corner that says &quot;Reload Prevalidation&quot;. This button will manually re-check the respective tables
                  associated with the prevalidation system, in case the system does not automatically run after you add data to the system.
                </Typography>
              </AccordionDetails>
            </Accordion>
            <Accordion>
              <AccordionSummary>
                <Typography level={"title-lg"} sx={{ paddingBottom: '1em' }}>Measurements Hub</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography level={"body-lg"}>
                  The Measurements Hub contains two primary links &em; the View Measurements link and the View Uploaded Files link. <br />
                  You can use the View Measurements link to review uploaded information once it&apos;s been inserted, and you can use the
                  View Uploaded Files link to review past loaded files for the respective plot &amp; census combination you are adding data to, as well as
                  delete or download them. <br /> <br />
                  The View Measurements link and upload system will be disabled until you successfully populate all of the supporting data views.
                  Once this is done and the prevalidation system reloads, you will be able to click on the View Measurements link.
                  Use the Upload button there to upload information conforming to the <b>census.txt</b><br />
                </Typography>

              </AccordionDetails>
            </Accordion>
            <Accordion>
              <AccordionSummary>
                <Typography level={"title-lg"} sx={{ paddingBottom: '1em' }}>Supporting Data Views</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography level={"body-lg"} component={"div"}>
                  The <b>Supporting Data Views</b> expands to allow you to modify the different moving parts of a
                  census that you would originally modify through CTFSWeb.
                  <AccordionGroup sx={{ paddingTop: '1em' }}>
                    <Accordion sx={{ paddingBottom: '1em' }}>
                      <AccordionSummary>
                        <Typography level={"title-lg"}>Attributes</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography level={"body-lg"}>
                          These are the codes used by field personnel to describe the condition of a tree, stem or
                          measurement. These codes are locally derived and can be in any language. These tree
                          measurement codes will eventually be inserted into the TSMAttributes table, which is a permanent
                          table.
                        </Typography>
                        <List marker={"disc"}>
                          <ListItem><b>code</b>: one or more letters that describe or explain the condition of a tree, stem,
                            or
                            measurement (e.g. “L”)</ListItem>
                          <ListItem><b>description</b>: a free text description of the code (e.g. “leaning”)</ListItem>
                          <ListItem nested>
                            <ListItem>
                              <b>status</b>: one of six standardized terms used as a summary category for the code and the
                              condition of the stem which it describes:
                              <Tooltip size={"lg"} color={"warning"} title={attributeNote}>
                                <IconButton>
                                  <WarningIcon fontSize={"small"} />
                                </IconButton>
                              </Tooltip>
                            </ListItem>
                            <List marker={"circle"}>
                              <ListItem><b>alive</b>: the stem is alive</ListItem>
                              <ListItem><b>alive-not measured</b>: the stem is alive but was not measured</ListItem>
                              <ListItem><b>dead</b>: the ENTIRE TREE is dead</ListItem>
                              <ListItem><b>missing</b>: field crews missed this stem, and it was not measured during the
                                census</ListItem>
                              <ListItem>
                                <b>broken below</b>: the stem was previously ≥ 1 cm dbh, but in this census was found alive
                                but broken off, now with a dbh less than 1 cm
                              </ListItem>
                              <ListItem><b>stem dead</b>: the stem is dead and/or not found</ListItem>
                            </List>
                            <ListItem>
                              e.g. We may call a tree in the field “MS;R” – MS (multiple stems) could have an
                              “alive” status on this table and R (description: resprout) would have “broken below.”
                            </ListItem>
                          </ListItem>
                        </List>
                      </AccordionDetails>
                    </Accordion>
                    <Accordion>
                      <AccordionSummary>
                        <Typography level={"title-lg"}>Personnel</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography level={"body-lg"}>
                          This file contains the names of the people who are or were involved with the plot, as well as the
                          role
                          that they played. If a person has played more than one role (for example she was a field
                          technician in
                          one census, then promoted to field supervisor in a later census), then that name should be entered
                          twice. This file should have three columns, as designated below.
                        </Typography>
                        <List marker={"disc"}>
                          <ListItem><b>firstname</b>: the first (given) name of the person</ListItem>
                          <ListItem><b>lastname</b>: the last name (surname) of the person</ListItem>
                          <ListItem><b>role</b>: the role the person played in the census. This should match exactly one of
                            the
                            descriptions in the role.txt file.</ListItem>
                        </List>
                      </AccordionDetails>
                    </Accordion>
                    <Accordion>
                      <AccordionSummary>
                        <Typography level={"title-lg"}>Quadrats</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography level={"body-lg"}>
                          This file contains a complete list of all quadrats used in your plot.
                        </Typography>
                        <List marker={"disc"}>
                          <ListItem><b>quadrat</b>: the name of the quadrat, e.g. 0002</ListItem>
                          <ListItem><b>startx</b>: the x coordinate of the lower left corner of the quadrat, e.g.
                            0</ListItem>
                          <ListItem>
                            <b>starty</b>: the y coordinate of the lower left corner of the quadrat, e.g. 40
                            <Tooltip size="lg" color={"warning"} title={quadratNote}>
                              <IconButton>
                                <WarningIcon fontSize={"small"} />
                              </IconButton>
                            </Tooltip>
                          </ListItem>
                          <ListItem><b>dimx</b>: the x dimension of the quadrat (in meters), e.g. 20</ListItem>
                          <ListItem><b>dimy</b>: the y dimension of the quadrat (in meters), e.g. 20</ListItem>
                        </List>
                      </AccordionDetails>
                    </Accordion>
                    <Accordion>
                      <AccordionSummary>
                        <Typography level={"title-lg"}>Subquadrats (Optional)</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography level={"body-lg"}>
                          If needed, you can submit subquadrat information in a file format similar to the quadrats file. <br />
                          This is <b>not needed</b> in order to complete a census, BUT <br />
                          If you do not add or upload subquadrats and try to reference them in your census.txt file, the values will be IGNORED.
                        </Typography>
                        <List marker={"disc"}>
                          {/* {label: "quadrat"}, {label: "xindex"}, {label: "yindex"}, {label: "unit"}, {label: "orderindex"}], */}
                          <ListItem><b>subquadrat</b>: the name of the subquadrat</ListItem>
                          <ListItem><b>quadrat</b>: the overhead quadrat it belongs to</ListItem>
                          <ListItem><b>dimx</b>: the x-dimensions of the subquadrat (default is 5m)</ListItem>
                          <ListItem><b>dimy</b>: the y-dimensions of the subquadrat (default is 5m)</ListItem>
                          <ListItem><b>xindex</b>: starting x-coordinates (top left corner) of subquadrat</ListItem>
                          <ListItem><b>yindex</b>: starting y-coordinates (top left corner) of subquadrat</ListItem>
                          <ListItem><b>unit</b>: Please provide the SI unit (mm, cm, dm, m, Dm, hm, km); default is meters</ListItem>
                          <ListItem><b>orderindex</b>: the order of the subquadrat within the quadrat at large, starting from top left corner</ListItem>
                        </List>
                      </AccordionDetails>
                    </Accordion>
                    <Accordion>
                      <AccordionSummary>
                        <Typography level={"title-lg"}>Species</Typography>
                      </AccordionSummary>
                      <AccordionDetails>
                        <Typography level={"body-lg"}>
                          This file is integral to a key table in the system, so take time to review it for spelling errors,
                          etc. Make
                          sure the IDLevels are filled in. There should be at least one species code for unidentified
                          species if
                          your plot includes species not yet identified. There are four required columns (“spcode,” “genus,”
                          “species,” and “IDLevel”); the rest are optional.
                        </Typography>
                        <List marker={"disc"}>
                          <ListItem nested>
                            <ListItem><b>spcode</b>: a code used in the field to identify the species of the tree</ListItem>
                            <List marker={"circle"}>
                              <ListItem>Most ForestGEO sites use six letter codes where the first four are from the genus
                                name and
                                the last two are from the species. If two species yield the same code, then an alternative
                                letter or number as the last character may be used to differentiate them. For example,
                                codes for Shorea macroptera subsp. baillonii and Shorea macrophylla, would both be
                                SHORMA. The species codes ended up being SHORMB and SHORMC, respectively.</ListItem>
                              <ListItem>You should use a similar naming convention for each morphospecies incorporating
                                details
                                you know. For example, using LITSBL (Litsea “Big Leaf”) or APORS1 (Aporosa sp. 1) are
                                fine as long as each code applies to only one morphospecies. These can be changed once
                                identification is more complete</ListItem>
                              <ListItem>Other combinations are also acceptable. Some sites use 3 letters from the genus and
                                3
                                from the species, while others use 4 letters instead of 6 (2 letters from the genus and 2
                                from
                                the species).</ListItem>
                            </List>
                          </ListItem>
                          <ListItem><b>genus</b>: the taxonomic genus name according to the APG system. In case of an
                            unknown genus, use “Unidentified.”</ListItem>
                          <ListItem><b>species</b>: the species part of the Latin name; may be a morphospecies
                            name.</ListItem>
                          <ListItem><b>idlevel</b>: the deepest taxonomic level for which full identification is known. The
                            IDLevel is limited to the values of: species, subspecies, genus, family, none, or multiple. “None” is used
                            when the family is not known. “Multiple” is used when the name may include a mixture of more
                            than one species.</ListItem>
                          <ListItem><b>family</b>: the taxonomic family name (optional)</ListItem>
                          <ListItem><b>authority</b>: author of the species (optional)</ListItem>
                          <ListItem><b>subspecies</b>: subspecies identifier (optional)</ListItem>
                          <ListItem><b>subspeciesauthority</b>: authority of subspecies (optional)</ListItem>
                        </List>
                      </AccordionDetails>
                    </Accordion>
                  </AccordionGroup>
                </Typography>
              </AccordionDetails>
            </Accordion>
          </AccordionGroup>
        </>
      )}
    </Box>
  );
}
