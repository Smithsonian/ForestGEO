"use client";

import { Box, Card, CardContent, Chip, Divider, List, ListItem, ListItemContent, ListSubheader, Stack, Tooltip, Typography } from "@mui/joy";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import { useLockAnimation } from "@/app/contexts/lockanimationcontext";

export default function DashboardPage() {
  const { triggerPulse } = useLockAnimation();
  const _attributeNote =
    "NOTE: If a code can be used for more than one status (e.g. The code “L” for a leaning tree, could\n" +
    "apply to either a dead or alive stem), or if a code does not indicate any of the above status\n" +
    "options, the status column should be left blank.";
  const _quadratNote =
    "NOTE: The x and y coordinates (“startx” and “starty”) refer to the distance in meters between\n" +
    "the quadrat under question and lowest, left-most corner of the entire plot (or\n" +
    "wherever your plot origin, or 0,0 coordinates are).";
  const _censusNote1 =
    "NOTE: Each of the multiple stems should be included in these files. You may indicate in the codes\n" +
    "field which one is the main stem (if the tree has only one stem, you do not have to include the main\n" +
    "stem code). The rest of the information should be repeated for each multiple stem. Make sure that\n" +
    "the information (species code, date, etc.) is exactly the same for all multiple stems of the same tree. ";
  const _censusNote2 =
    "NOTE: The dataset for each census should only contain trees and stems that were tagged and\n" +
    "measured from that census. The dataset for subsequent censuses should contain all live stems from\n" +
    "the previous census. Dead or lost stems should have the appropriate codes to indicate their absence\n" +
    "in subsequent censuses.";
  return (
    <Box
      sx={{
        display: "flex",
        flexGrow: 1,
        width: "99%",
        flexDirection: "column",
        marginBottom: 5
      }}
    >
      <Stack direction={"row"} divider={<Divider orientation="vertical" sx={{ mx: 1 }} />}>
        <Card variant="soft" color="primary" invertedColors sx={{ width: "50%" }}>
          <CardContent>
            <Typography level="title-lg">Core Functions and Features</Typography>
            <List marker="disc">
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">
                    Use the selection menus to pick your <strong>site</strong>, <strong>plot</strong>, and <strong>census</strong>
                  </Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">
                    The navigation menu will <strong>not</strong> become visible until you have selected a site, plot, and census.
                  </Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">You will need to submit supporting data before being able to submit new measurements for your census.</Typography>
                </ListItemContent>
              </ListItem>
              <ListItem>
                <ListItemContent>
                  <Typography level="body-md">Stem & Plot Details - Use this supporting menu to enter fixed data for your census.</Typography>
                </ListItemContent>
              </ListItem>
              <ListItem nested>
                <ListSubheader>Stem & Plot Details</ListSubheader>
                <List marker="circle">
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        Stem Codes - Submit attribute information for stems here. <strong>Does not require a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        Personnel - Submit personnel working in your census here. <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        Quadrats - Submit quadrat information for stems here. <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        Species List - Submit species and taxonomy information for stems here. <strong>Does not require a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                  <ListItem>
                    <ListItemContent>
                      <Typography level="body-md">
                        Plot-Species List - See existing taxonomy information for stems in your plot and census here. <strong>Requires a census.</strong>
                      </Typography>
                    </ListItemContent>
                  </ListItem>
                </List>
              </ListItem>
            </List>
            <Tooltip title="This form creates and submits a Github issue!">
              <Chip variant="soft" startDecorator={<HelpOutlineOutlinedIcon fontSize="medium" />} onClick={triggerPulse}>
                <Stack direction={"column"}>
                  <Typography level="body-md">This is a feedback form!</Typography>
                </Stack>
              </Chip>
            </Tooltip>
          </CardContent>
        </Card>
        <Card variant="soft" color="primary" invertedColors sx={{ width: "50%" }}>
          <CardContent>
            <Typography level="title-lg">Completing a Census</Typography>
            <Typography>Description of the card.</Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
