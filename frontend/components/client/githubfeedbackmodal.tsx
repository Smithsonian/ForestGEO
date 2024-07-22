"use client";

import { Box, Button, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormLabel, Grid, Input, Modal, ModalClose, ModalDialog, ModalOverflow, Radio, RadioGroup, Stack, Textarea, Tooltip, Typography } from "@mui/joy";
import { useState } from "react";
import {
  BugReport,
  Error as ErrorIcon,
  Info,
  Build,
  AccessibilityNew,
} from '@mui/icons-material';
import { Octokit } from "octokit";
import { useOrgCensusContext, usePlotContext, useSiteContext } from "@/app/contexts/userselectionprovider";

// this has been shelved -- it's a little too complicated for a first iteration.
// saving it for a later version.
const issueTypes = [
  { value: "data-issue", label: "Data Issue", icon: <BugReport />, tooltip: "Problems with missing information, incorrect data, or file upload issues." },
  { value: "ui-issue", label: "UI/UX Issue", icon: <ErrorIcon />, tooltip: "Problems with buttons, pop-ups, navigation, or how the site looks and feels." },
  { value: "functional-issue", label: "Functional Issue", icon: <Build />, tooltip: "Issues with features not working, broken links, or buttons that don't respond." },
  { value: "accessibility-issue", label: "Accessibility Issue", icon: <AccessibilityNew />, tooltip: "Problems with accessing or using the site, especially for users with disabilities." },
  { value: "other", label: "Other Issue", icon: <Info />, tooltip: "Any other feedback or issues not listed above." },
];

type IssueType = typeof issueTypes[number]["value"];

type GithubFeedbackModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function GithubFeedbackModal({ open, onClose }: GithubFeedbackModalProps) {

  const [name, setName] = useState<string>("");
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [description, setDescription] = useState("");
  const pat = process.env.FG_PAT;
  const owner = process.env.OWNER;
  const repo = process.env.REPO;
  if (!pat || !owner || !repo) throw new Error('env var retrieval failed.');

  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const octokit = new Octokit({
    auth: pat
  });

  async function handleSubmitIssue() {
    // handle the issue submission logic here
    const results = await octokit.request(`POST /repos/${owner}/${repo}/issues`, {
      owner: owner,
      repo: repo,
      title: `APP-USER-GENERATED: Feedback Ticket Created for Issue Type: ${issueType}`,
      body: description,
      milestone: 1,
      labels: [
        'useridentifiedbug'
      ],
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    console.log('octokit results: ', results);
    if (results.status !== 201) throw new Error("Failed to create GitHub issue");
    const previewResults = await octokit.request(`POST /repos/${owner}/${repo}/issues`, {
      owner: owner,
      repo: repo,
      headers: {
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    console.log('preview of GET results: ', previewResults);
  }

  function handleCancel() {
    setName('');
    setIssueType(null);
    setDescription('');
    onClose();
  }

  return (
    <Modal open={open} sx={{ display: "flex", flex: 1, flexDirection: "row" }}>
      <ModalOverflow>
        <ModalDialog role="alertdialog">
          <ModalClose variant="outlined" onClick={handleCancel} />
          <DialogTitle sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
            <Typography level="h1">GitHub Feedback Form</Typography>
            <Divider orientation="horizontal" sx={{ my: 1 }} />
            <Grid container spacing={1}>
              <Grid xs={4}>
                {currentSite ? (
                  <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                    <Typography level="body-md">Selected Site: {currentSite.siteName}</Typography>
                    <Typography level="body-sm">&mdash;Schema: {currentSite.schemaName}</Typography>
                  </Box>
                ) : (
                  <Typography level="body-md">No site selected.</Typography>
                )}
              </Grid>
              <Grid xs={4}>
                {currentPlot ? (
                  <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                    <Typography level="body-md">Selected Plot: {currentPlot.plotName}</Typography>
                    <Typography level="body-sm">&mdash;Location: {currentPlot.locationName}</Typography>
                  </Box>
                ) : (
                  <Typography level="body-md">No plot selected.</Typography>
                )}
              </Grid>
              <Grid xs={4}>
                {currentCensus ? (
                  <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
                    <Typography level="body-md">Selected Census: {currentCensus.plotCensusNumber}</Typography>
                  </Box>
                ) : (
                  <Typography level="body-md">No census selected.</Typography>
                )}
              </Grid>
            </Grid>
          </DialogTitle>
          <DialogContent>
            <Divider orientation="horizontal" sx={{ mb: 2, mt: 1 }} />
            <FormControl>
              <FormLabel>
                <Typography level="title-md">Name:</Typography>
              </FormLabel>
              <Input
                placeholder="John Do..."
                onChange={(event) => setName(event.target.value)}
                sx={{
                  "&::before": {
                    border: "1.5px solid var(--Input-focusedHighlight)",
                    transform: "scaleX(0)",
                    left: "2.5px",
                    right: "2.5px",
                    bottom: 0,
                    top: "unset",
                    transition: "transform .15s cubic-bezier(0.1,0.9,0.2,1)",
                    borderRadius: 0,
                    borderBottomLeftRadius: "64px 20px",
                    borderBottomRightRadius: "64px 20px",
                  },
                  "&:focus-within::before": {
                    transform: "scaleX(1)",
                  },
                  marginBottom: 2,
                }}
              />
            </FormControl>
            <FormControl>
              <Typography level="title-sm" mt={2} mb={1}>
                What kind of issue was it?
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <RadioGroup
                  orientation="horizontal"
                  aria-labelledby="issue-type-selection"
                  name="issue-type"
                  value={issueType}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setIssueType(event.target.value as IssueType)
                  }
                  sx={{
                    minHeight: 48,
                    padding: "4px",
                    borderRadius: "12px",
                    bgcolor: "neutral.softBg",
                    "--RadioGroup-gap": "4px",
                    "--Radio-actionRadius": "8px",
                  }}
                >
                  {issueTypes.map((issue) => (
                    <Tooltip key={issue.value} title={issue.tooltip} color="primary" placement="top">
                      <Radio
                        color="neutral"
                        value={issue.value}
                        disableIcon
                        label={issue.label}
                        variant="plain"
                        sx={{
                          px: 2,
                          alignItems: "center",
                        }}
                        slotProps={{
                          action: ({ checked }) => ({
                            sx: {
                              ...(checked && {
                                bgcolor: "background.surface",
                                boxShadow: "sm",
                                "&:hover": {
                                  bgcolor: "background.surface",
                                },
                              }),
                            },
                          }),
                        }}
                      />
                    </Tooltip>
                  ))}
                </RadioGroup>
              </Box>
            </FormControl>
            <FormControl>
              <Typography level="title-sm" mt={2} mb={1}>
                Can you describe the issue in more detail?
              </Typography>
              <Textarea
                variant="outlined"
                required
                onChange={(event) => setDescription(event.target.value)}
                placeholder="This component wasn't working..."
                sx={{
                  "--Textarea-focusedInset": "var(--any, )",
                  "--Textarea-focusedThickness": "0.15rem",
                  "--Textarea-focusedHighlight": "rgba(13,110,253,.25)",
                  "&::before": {
                    transition: "box-shadow .15s ease-in-out",
                  },
                  "&:focus-within": {
                    borderColor: "#86b7fe",
                  },
                  width: "100%",
                }}
              />
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Stack direction="row" justifyContent="flex-end" spacing={1} mt={2}>
              <Button variant="plain" onClick={() => handleCancel()}>
                Cancel
              </Button>
              <Button variant="solid" disabled={name === '' || issueType === null || description === ''} onClick={handleSubmitIssue}>
                Confirm
              </Button>
            </Stack>
          </DialogActions>
        </ModalDialog>
      </ModalOverflow>
    </Modal>
  );
}
