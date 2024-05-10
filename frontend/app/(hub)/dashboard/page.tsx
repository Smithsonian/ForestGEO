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
import { useSession } from "next-auth/react";

export default function DashboardPage() {

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
  const { data: session } = useSession();
  return (
    <Box sx={{ display: 'flex', flexGrow: 1, width: '85%', flexDirection: 'column', marginBottom: 5 }}>
      <Typography level={"body-lg"} sx={{ paddingBottom: '1em' }}>Please use this guide to navigate through this
        app&apos;s key features
        and functionalities.</Typography>
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
              <Typography level={"title-lg"}>Required Selections to Use the App -
                Site</Typography>
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
        <Accordion>
          <AccordionSummary>
            <Box sx={{ alignItems: 'center', flexDirection: 'row', display: 'flex' }}>
              <Avatar color={"primary"}>
                <PlotLogo />
              </Avatar>
              <Typography level={"title-lg"}>Required Selections to Use the App -
                Plot</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"}>
              Following the same format as the Site, clicking on the Select Plot link will open a dialog box to allow
              you to select a plot -- <br /> please note that the list of selectable plots will be restricted by access,
              so you will only be able to see plots you have been added to.
              <Tooltip color={"warning"} title={"Please contact an administrator if you cannot access the plot\n" +
                "          you are working on."}>
                <IconButton>
                  <WarningIcon fontSize={"small"} />
                </IconButton>
              </Tooltip>
            </Typography>
            {session?.user.isAdmin && (
              <>
                <Typography level="title-md">
                  Plot Creation
                </Typography>
                <Typography level="body-lg">
                  If you cannot see your plot or you are attempting to create a new plot, please use the Add New Plot button to
                  open the plot creation interface. <br />
                  Please ensure that you correctly input the global coordinates corresponding to your plot, as well as the correct
                  dimensions. The Area field will automatically update as you input coordinates. Please ensure that you correctly
                  select the respective units when defining your plot boundaries and dimensions.
                </Typography>
                <Typography level="title-md">
                  Plot Editing
                </Typography>
                <Typography level="body-lg">
                  If your plot&apos;s information does not seem correct or if you need to change any of your plot&apos;s details, please use the Edit
                  button when in the Select menu dropdown to open the plot editing interface. Once complete, press the Submit button to save
                  your changes. This will trigger a manual refresh of the site&apos;s core data.
                </Typography>
                <Typography level="title-md">
                  Plot Deletion
                </Typography>
                <Typography level="body-lg">
                  If, for any reason, you need to remove a plot, use the Delete button when in the Select menu dropdown. This action cannot be undone.
                  NOTE: while this will remove the plot from data storage, this will NOT delete other plot-associated information.
                </Typography>
              </>
            )}
          </AccordionDetails>
        </Accordion>
        <Accordion>
          <AccordionSummary>
            <Box sx={{ alignItems: 'center', flexDirection: 'row', display: 'flex' }}>
              <Avatar color={"primary"}>
                <CensusLogo />
              </Avatar>
              <Typography level={"title-lg"}>Required Selections to Use the App -
                Census</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"}>
              Similarly, clicking on the Select Census link will open a dialog box to allow you to select the census you
              would like to update.<br />
              Please note that available census will be organized by ongoing
              census <span style={{ fontWeight: 'bold' }}>first</span>, and historical censuses will be organized by
              chronological descending order. <br />
              Unlike the Site and Plot selections, Census selections are not restricted by access, so you should be able
              to select any available censuses.
            </Typography>
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>
      <Typography level="h3" sx={{ paddingBottom: '1em' }}>Navigating Through the Website</Typography>
      <AccordionGroup sx={{ paddingBottom: '2em' }}>
        <Accordion>
          <AccordionSummary>
            <Typography level={"title-lg"} sx={{ paddingBottom: '1em' }}>Measurements Hub</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"}>
              The Measurements Hub is intended to replace the main data view of CTFSWeb. <br />
              It contains a table view of the given site/plot/census&apos;s recorded measurements, utilizing a dedicated
              measurement summary view that provides detailed information about the measurements recorded in that
              period, along with a set of filtering buttons to allow you to choose if you want to exclude rows with
              validation errors or rows without.<br />
              As you upload new files using the <b>Upload</b> button present on the right side of the Measurements Hub
              page, please keep the following in mind regarding file input parameters and required headers:
            </Typography>
            <List marker={"disc"}>
              <ListItem nested>
                <ListItem>
                  The tree data from each census must be in a separate file (i.e. one census, one file; three censuses,
                  three files). All files must have columns listed below, but they can be in any order.<br />
                  <Tooltip size={"lg"} color={"warning"} title={censusNote1}>
                    <IconButton>
                      <WarningIcon fontSize={"small"} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip size={"lg"} color={"danger"} title={censusNote2}>
                    <IconButton>
                      <WarningIcon fontSize={"small"} />
                    </IconButton>
                  </Tooltip>
                </ListItem>
                <List marker={"circle"}>
                  <ListItem><b>tag</b>: the tag number for the tree (this should be unique for each tree)</ListItem>
                  <ListItem><b>stemtag</b>: the tag number of the stem.</ListItem>
                  <ListItem><b>spcode</b>: a code used in the field to identify the species of the tree. This MUST match
                    the
                    spcode that appears in the species.txt file.</ListItem>
                  <ListItem><b>quadrat</b>: the name of the quadrat (as designated in quadrat.txt) that the tree is
                    located in</ListItem>
                  <ListItem><b>lx</b>: the x coordinate in meters of the stem within its quadrat</ListItem>
                  <ListItem><b>ly</b>: the y coordinate in meters of the stem within its quadrat</ListItem>
                  <ListItem>
                    <b>dbh</b>: the diameter of the tree.
                    <Tooltip size={"lg"} color={"warning"}
                      title={"NOTE: If there is no diameter measurement because the tree is missing, dead, or a resprout,\n" +
                        "please put “NULL”"}>
                      <IconButton>
                        <WarningIcon fontSize={"small"} />
                      </IconButton>
                    </Tooltip>
                  </ListItem>
                  <ListItem>
                    <b>codes</b>: tree or measurement codes (as designated in codes.txt)
                    <Tooltip size={"lg"} color={"warning"}
                      title={"NOTE: If there is more than one code, they should be delimited with semicolons. This allows\n" +
                        "for codes with more than one letter. The codes field may be left blank if there are no\n" +
                        "codes."}>
                      <IconButton>
                        <WarningIcon fontSize={"small"} />
                      </IconButton>
                    </Tooltip>
                  </ListItem>
                  <ListItem>
                    <b>hom</b>: height (in meters) where the diameter was measured, if different from 1.3 meters.
                    <Tooltip size={"lg"} color={"warning"}
                      title={"NOTE: If the height of measurement was 1.3 meters, you may leave this field blank. "}>
                      <IconButton>
                        <WarningIcon fontSize={"small"} />
                      </IconButton>
                    </Tooltip>
                  </ListItem>
                  <ListItem><b>date</b>: the date the stem was measured, expressed in the format YYYY-MM-DD, e.g.
                    2011-02-24
                    to indicate the 24th of February, 2011. </ListItem>
                </List>
              </ListItem>
            </List>
          </AccordionDetails>
        </Accordion>
        <Accordion>
          <AccordionSummary>
            <Typography level={"title-lg"} sx={{ paddingBottom: '1em' }}>Measurement Properties Hub</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"} component={"div"}>
              The <b>Measurement Properties Hub</b> expands to allow you to modify the different moving parts of a
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
                        unknown genus,
                        use “Unidentified.”</ListItem>
                      <ListItem><b>species</b>: the species part of the Latin name; may be a morphospecies
                        name.</ListItem>
                      <ListItem><b>IDLevel</b>: the deepest taxonomic level for which full identification is known. The
                        IDLevel is
                        limited to the values of: species, subspecies, genus, family, none, or multiple. “None” is used
                        when the family is not known. “Multiple” is used when the name may include a mixture of more
                        than one species.</ListItem>
                      <ListItem><b>family</b>: the taxonomic family name (optional)</ListItem>
                      <ListItem><b>authority</b>: author of the species (optional)</ListItem>
                      <ListItem><b>subspecies</b>: subspecies identifier (optional)</ListItem>
                    </List>
                  </AccordionDetails>
                </Accordion>
                <Accordion>
                  <AccordionSummary>
                    <Typography level={"title-lg"}>SubSpecies</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Typography level={"body-lg"}>
                      Similar to the Species data grid, this grid displays added subspecies information as provided for
                      this plot. This is not a required part of a census, so please take note that not every measurement
                      or species will have an associated subspecies unless needed.
                    </Typography>
                  </AccordionDetails>
                </Accordion>
              </AccordionGroup>
            </Typography>
          </AccordionDetails>
        </Accordion>
        <Accordion disabled>
          <AccordionSummary>
            <Typography level={"title-lg"}>
              Manual Input Forms (CTFSWeb)
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography level={"body-lg"}>
              This form is available as a backstop to census file upload, in case it does not work for any reason or
              your file is corrupted. This form will enable you to submit census information in the same format as the
              census.txt form provided by CTFSWeb. <br />
              Please take advantage of the autocompletion functionality the form provides in order to more efficiently
              add information.
            </Typography>
            <Tooltip color={"warning"} title={"Note: The census form relies on successful input of fixed data (" +
              "attributes, personnel, quadrats, species)."}>
              <IconButton>
                <WarningIcon fontSize={"small"} />
              </IconButton>
            </Tooltip>
          </AccordionDetails>
        </Accordion>
      </AccordionGroup>
    </Box>
  );
}
