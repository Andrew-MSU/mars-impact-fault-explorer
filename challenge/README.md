# Your first simulation

This folder is for Wheeler Feer. Andrew Laskowski is the PI. The job is one simulation, then a look at the website.

The project question is: can a large impact on Mars start a magnetic field strong enough to help hold onto an atmosphere? One idea is slow. Faults break, a weak zone forms, rock starts to sink, and cold rock at the core makes the core lose heat. Losing heat can run a dynamo. The other idea is fast. The impact stirs the liquid core by changing how fast the planet spins. Stirring can make a field quickly. Heating the top of the core can also shut a field off.

You are going to run the same equations the website uses, read the table, and answer four questions. A "no" is a real result. The goal is to be able to say what the model did.

Do the steps in order. Each step ends with a checkpoint, a line that says what you should see. If the repository is not on your computer yet, start with Get set up.

## Get set up

This section puts the project on your computer and installs the programs the later steps call. Do it once. Mac commands are on the left. Windows commands are on the right, and they assume **Git Bash**, the terminal that comes with Git for Windows. The prompt in Git Bash looks like a Mac prompt.

Open a terminal first.

- Mac: open **Terminal** (search Spotlight for Terminal).
- Windows: install Git in the next step, then open **Git Bash** from the Start menu. The ordinary Command Prompt will not match the commands below.

### 1. Install Git

Git is the tool that downloads the project and, later, picks up updates.

| | Mac | Windows |
| --- | --- | --- |
| Install | In Terminal, run `xcode-select --install` and click Install in the window that appears. If you already use Homebrew, `brew install git` is the other way. | Download **Git for Windows** from [https://git-scm.com/download/win](https://git-scm.com/download/win) and accept the defaults. Then open **Git Bash**. |

```bash
git --version
```

You should now see a line like `git version 2.39.0` or any `git version 2.` something. The number does not have to match. If the shell says `command not found` or `not recognized`, the install did not finish or the terminal was opened too early. Close it, open a new one, and try again.

### 2. Download the repository

From any folder you are happy to keep the project in (on Mac, home is fine; in Git Bash, home is also fine):

```bash
git clone https://github.com/Andrew-MSU/mars-impact-fault-explorer.git
cd mars-impact-fault-explorer
```

You should now see Git print `Cloning into 'mars-impact-fault-explorer'...` and then a prompt in that folder. Check:

```bash
ls package.json challenge
```

You should now see `package.json` and a `challenge` directory listed. Every later command assumes this folder is the one you are in. `pwd` prints the folder. It should end in `mars-impact-fault-explorer`.

**No Git.** On the repository page, click the green **Code** button, then **Download ZIP**. Unzip it. The folder may be named `mars-impact-fault-explorer-main`. In the terminal:

```bash
cd ~/Downloads/mars-impact-fault-explorer-main
```

Use the real path if you unzipped it somewhere else. `ls package.json` should still print `package.json`. A ZIP download has no Git history, so the update command at the end of this section will not work. Download a new ZIP when you want a newer copy.

### 3. Install Node.js

Node runs the simulation and the website on your machine. The tests for this repository run on **Node.js 22** (the version in `.github/workflows/pages.yml`). Node 20 or newer also runs the scripts. There is no `engines` field in `package.json`.

| | Mac | Windows |
| --- | --- | --- |
| Install | Download the **22 LTS** (or the current LTS, if it is 22 or newer) installer from [https://nodejs.org](https://nodejs.org). If a version menu is offered, choose 22. If you use Homebrew: `brew install node@22`. | Use the same site and the Windows installer. Accept the option that adds Node to PATH. Close Git Bash and open it again. |

```bash
node --version
npm --version
```

You should now see `v22` (or `v20` or a newer `v2` something of 20 or higher) and an npm version on the next line. `v16` or `v18` is too old.

Install the website's packages. This can take a minute the first time. You need a network connection.

```bash
npm install
```

You should now see a line like `added 15 packages` (the count can change). A `node_modules` folder now sits next to `package.json`. The simulation itself does not read that folder. The local website does.

Start the site once, so you know the install worked:

```bash
npm run dev
```

You should now see a line `Local: http://localhost:5173/` (the port can be 5174 if 5173 is busy). Open that address in a browser. The Mars Impact Fault Explorer page should load. Stop the server with Ctrl+C when you have seen it. You will start it again at the end, after the simulation.

### 4. Install Python and a virtual environment

Python runs the file checker. The repository's tests use **Python 3.12**. Python 3.9 or newer is enough for the checker and the converter. Those two scripts use only the Python standard library, so they do not need extra packages. A virtual environment is a private folder for Python packages so this project does not change the rest of your computer.

| | Mac | Windows (Git Bash) |
| --- | --- | --- |
| Install | Download Python 3.12 from [https://www.python.org/downloads/](https://www.python.org/downloads/) if `python3` is missing, or `brew install python@3.12`. | Download the same Windows installer. On the first screen, check **Add python.exe to PATH**. |
| Check | `python3 --version` | `py -3 --version` |
| Create | `python3 -m venv .venv` | `py -3 -m venv .venv` |
| Activate | `source .venv/bin/activate` | `source .venv/Scripts/activate` |

You should now see `Python 3.12` or another `Python 3.9` or newer from the check command. After activate, the prompt starts with `(.venv)`. That prefix means the private environment is on. It lasts until you close the terminal. Next time you open a terminal, `cd` into the repository and run the activate command again.

```bash
python -m pip install -r challenge/requirements.txt
```

You should now see the prompt come back with no error text. pip stays quiet when every line in the file is a comment, which is the case here. That silence is the checkpoint. An error would name a missing file or a package it could not download. VPLanet is listed in that file as a comment, for the optional section later. Leave it commented for now.

Checkpoint for the whole setup: the prompt shows `(.venv)`, `pwd` ends in the repository folder, and these three commands print versions rather than `command not found`:

```bash
git --version
node --version
python --version
```

`python` (no 3) is the right command after activation, on Mac and on Windows. Before activation, Mac uses `python3` and Windows Git Bash uses `py -3`.

### 5. Later updates

When Andrew says the repository changed, and you cloned with Git:

```bash
cd mars-impact-fault-explorer
git pull
```

You should now see `Already up to date.` or a short list of files that changed. Run it from the repository folder. If you used Download ZIP, `git pull` cannot work. Download a new ZIP instead.

Then continue with the three commands below.

## The three commands

From the repository root (the folder that contains `package.json` and this `challenge` folder):

```bash
node challenge/run_explorer_model.mjs
python challenge/validate_offline_run.py challenge/output/baseline_offline_run.json
node challenge/check_loads.mjs challenge/output/baseline_offline_run.json
```

With `(.venv)` showing, `python` is right on Mac and on Windows. If the prefix is missing, Mac can use `python3` and Windows Git Bash can use `py -3` for that second command. The first and third commands stay the same.

If you have not used a terminal before: open the terminal, `cd` into the repository, paste one command, press Enter, and wait until the terminal gives you a new prompt. Then paste the next command.

The rest of this page explains what those commands do, what the words mean, and how to read the result. VPLanet is a second, optional program. Do it after these three commands work.

## What a model is, and why we run one

A model is a set of equations that stand in for the planet. We cannot rerun Mars. We can rerun the equations. A simulation is one run of those equations, with the numbers we chose.

The numbers are uncertain. The core might be 1650 km across, or 1830 km, or it might have a 613 km solid center. The mantle might be dry or wet. The impact might be small or huge. A simulation shows what those choices do. Changing one number and running again shows which part of the answer moves, and which part does not.

This first path uses the website's Basin & Global estimate. It is a simplified calculation: a fault catalog, a heat budget for the core, and two ways an impact can affect that budget. It is fast (about a second). It is the right first run because it answers the project question with the same buttons you will see on the site.

It is a practice result. It is not a published answer, and it is not a VPLanet integration.

## Words

| Word | Meaning |
| --- | --- |
| Dynamo | A magnetic field made by motion in a liquid metal core. "The dynamo is on" means the model is estimating a field. |
| Magnetic moment | The strength of that field, in ampere square meters (A m²). Earth's moment is about 7.8×10²² A m². A bigger number is a stronger field. 10²⁴ is a thousand times 10²¹. |
| Gunell gate | The bar used on the website. Gunell et al. (2018) found atmospheric escape can peak near a moment of 2.5×10²⁴ A m². This project counts a field as protective only past that peak, and only if the magnetopause also clears the upper atmosphere. A weaker field can exist and still fail the gate. |
| Magnetopause | The boundary where the planet's field stands off the solar wind. |
| Standoff | Magnetopause radius divided by Mars's radius. 1 means no field beyond the surface. 3 means the boundary is three Mars radii from the center. |
| CMB | Core-mantle boundary. The surface of the metallic core, where it meets the rock. |
| CMB heat flux | Heat flowing out of the core across that surface, in milliwatts per square meter (mW/m²). Heat leaving the core is what a thermal dynamo needs. |
| Adiabatic flux | The heat flow the core would carry if it were only stratified, with no convection. A thermal dynamo is estimated from the part of the CMB flux above this number. |
| Elastic thickness | How thick a layer of the outer planet still behaves like a stiff plate, in km. Early Mars is set to 15 km here. The present day is 100 km. A thin plate is easier to break. |
| Regime | The headline label. `slip` means faults move. `lid` means the stiff outer plate fails. `dynamo` means the protective-field tests pass. `none` means none of those. |
| Water fraction | 0 is dry rock. 1 is wet rock. Wet rock has weaker faults. |
| Subduction index | A ratio of forces that would start a plate sinking. It has to reach 1. Below 1, the slow path has not started. |
| Spin stirring | The fast path. The impact changes the spin. `spin_ratio` is the size of that change divided by the planet's spin. Stirring turns on at 0.02 in this model. That 0.02 is an assumption, not a number measured on Mars. |
| Point-load limit | The fault calculation treats the crater as a point. That is reasonable for smaller impacts. Impactors of about 80 km and larger are outside that assumption. The table marks them. |
| Core presets | 1650 km plus a 150 km molten rock layer (the baseline). 1830 km, a fully liquid core with no molten layer (the spreadsheet's VPLanet row). A 613 km solid inner core inside the 1650 km core. |

## Before you start

Get set up leaves you in the repository folder with `(.venv)` on the prompt. If you opened a new terminal since then, `cd` into the repository and activate again.

| | Mac | Windows (Git Bash) |
| --- | --- | --- |
| Turn the environment back on | `source .venv/bin/activate` | `source .venv/Scripts/activate` |

```bash
ls package.json
```

You should now see `package.json`. If the shell says it is missing, you are not in the repository folder yet.

## Step 1. Run the model

```bash
node challenge/run_explorer_model.mjs
```

The script prints a line per case (`Running 1/10` through `Running 10/10`), then three blocks. Leave the knobs at the top of the file alone for this first run.

You should now see a background block like this. Yours should match if you did not edit the file:

```text
Background, no impactor, selected core. Compare each table row with this.
water  regime  dynamo_on  moment_A_m2   q_cmb_mW/m2  q_adiabatic_mW/m2  subduction_index
    0     slip       false      3.601e+20         86.28                2.97           2.509e-2
    1      lid       false      3.601e+20         86.28                2.97           4.222e-2
```

`3.601e+20` means 3.601 × 10²⁰. The background is the planet with no impactor. Dry faults are already at slip. Wet, the lid is already failed. The moment is the same either way.

Then the website file, ten rows (five impactor sizes, dry and wet). The moment column stays `3.601e+20`. `dynamo_on` stays `false`. `onset_yr` stays `null`. Dry rows say `slip`. Wet rows say `lid`. Rows at 100 km and 300 km are marked `NO (>80 km)` because they are outside the point-load limit. They are in the run so you can see whether a very large impact changes the field. On this default, it does not.

Then a core comparison. At 1 km and dry, the three moments are:

| Core | Moment (A m²) | dynamo_on |
| --- | --- | --- |
| bml (1650 km + melt) | 3.601×10²⁰ | false |
| homogeneous (1830 km) | 4.808×10²⁰ | false |
| inner (613 km solid center) | 3.085×10²⁰ | false |

Checkpoint: the command finishes in a few seconds, and the last lines name two files:

```text
challenge/output/baseline_offline_run.json
challenge/output/core_sensitivity.json
```

`baseline_offline_run.json` is the file the website can load. It is the 1650 km core. `core_sensitivity.json` is the comparison table, including the no-impactor lines. Read that one. Do not put it in `data/offline_runs/`. The website would not know which core you meant.

A copy of this finished default is already in `challenge/example/`, so you can open it before you run.

## Step 2. Check the file

```bash
python3 challenge/validate_offline_run.py challenge/output/baseline_offline_run.json
```

You should now see:

```text
Valid. challenge/output/baseline_offline_run.json has 10 run(s) in the explorer schema.
The website can load this file.
```

If you see `Not valid:`, the message under it is the thing to fix. The default run should already be valid.

## Step 3. Ask the website's loader to read it

```bash
node challenge/check_loads.mjs challenge/output/baseline_offline_run.json
```

You should now see `The explorer's loader accepted this file.` and, for the 1 km dry point, `dynamo_on: false` and `regime: slip`.

That loader is the function the Basin & Global page calls when an offline file is selected. Step 3 does not open a browser. The website section at the end does.

## Questions

Write four short answers, a few sentences each. Use the table from Step 1. The hints say where to look.

The Gunell gate in this run is 2.5×10²⁴ A m². It is the value `gunell_gate_Am2` at the top of both JSON files.

1. Does this run's field clear the Gunell gate?

   Hint: `dynamo_on` is the yes or no. `magnetic_moment_Am2` is the size. Divide 2.5×10²⁴ by the moment in the 1650 km column. Also look at `standoff_over_rp` (about 3.5 on the 1650 km core). A standoff of a few means there is a magnetopause. The gate is a separate test, on the moment.

2. When does a protective field start?

   Hint: `time_to_onset_yr`, and the `onset_yr` column. `null` means this run never starts one. It does not mean "at the beginning of Mars."

3. How sensitive is that to core size?

   Hint: use the three moments in the table above (1650, 1830, 613). Rank them. Then say whether any of the three flips `dynamo_on` to true. The 1830 km core is the spreadsheet's VPLanet baseline. The 1650 km core is the one this file uses.

4. Which pathway is doing the work, the slow one or the fast one?

   Hint: compare the background lines (no impactor) with the 1 km rows and the 300 km rows. List the columns that stay the same. The slow path needs the subduction index to reach 1 before cold rock is delivered to the core. The background values are about 0.025 (dry) and 0.042 (wet). The fast path is stirring. In `core_sensitivity.json`, read `spin_ratio` on the 300 km, water 0, `bml` row, and compare it with `stirring_turns_on_when_spin_ratio_reaches` (0.02). Also notice what water does: dry stays `slip`, wet is `lid`, and `dynamo_on` does not follow that change.

After those four, if you want one more run: open `challenge/run_explorer_model.mjs`, change only `RADIO_SCALE` from `1` to `2`, save, and run Step 1 again. Radiogenic heating is heat from uranium, thorium, and potassium in the rock. Write down what happened to the moment and to `q_cmb`. Set `RADIO_SCALE` back to `1` when you are done. One knob at a time, or you will not know which change mattered.

## What you can change

The knobs are the block at the top of `challenge/run_explorer_model.mjs`. Everything below that block is the run itself.

| Knob | What it does |
| --- | --- |
| `EPOCH` | `"early"` or `"present"`. Early uses a higher mantle heat flow and a 15 km elastic thickness. |
| `DIAMETERS_M` | Impactor diameters, in meters. 1000 is 1 km. |
| `WATER_FRACTIONS` | Dry is 0. Wet is 1. |
| `IMPACT_LON`, `IMPACT_LAT` | Where it hits. The default is Hellas (70.5, −42.4). Valles Marineris is about −70.2, −9.2. Isidis is about 87, 12.9. |
| `VELOCITY_M_S`, `ANGLE_DEG` | Speed and angle. 10000 is 10 km/s. 90 degrees is straight down. 45 is the most common angle. |
| `CORE_PRESET` | `"bml"`, `"homogeneous"`, or `"inner"`. This chooses which core is written into the website file. The comparison table always has all three. |
| `RADIO_SCALE` | Multiplies radiogenic heating. 1 is the spreadsheet. |
| `TE_KM_OVERRIDE` | Leave `null`. Set a number only if you want to override the elastic thickness. |

Rows marked `NO (>80 km)` are outside the point-load model. Read them as a test of the fast path, not as a realistic crater.

## You are done with the simulation when

- The validator prints `Valid` and `10 run(s)`.
- The loader prints `The explorer's loader accepted this file.`
- You have four written answers, each one pointing at a column you actually read.
- You can say, in one sentence, whether the impact in this run is what turns the field on.

## Optional: VPLanet

Do this only after the section above works. VPLanet is a separate program. It integrates a planet's interior temperature and magnetic moment forward in time. ThermInt is the interior module. RadHeat is the radioactive-heating module.

Two limits, before you install anything:

- The VPLanet you install with pip fixes the metallic core at Earth's radius, 3481 km. It has no input for 1650 km, 1830 km, or 613 km. The core-size question stays on the first path.
- This template sets Mars's mass and orbit, and Mars-like starting temperatures. The moment it prints is a practice history of that setup. It is not a 1650 km Mars-core result.

You can convert a finished example without installing VPLanet, to see the file shape:

```bash
python3 challenge/vplanet_to_explorer.py challenge/example/vplanet_case -o challenge/output/vplanet_offline_run.json
python3 challenge/validate_offline_run.py challenge/output/vplanet_offline_run.json
```

You should now see a peak moment of about `6.654704e+22` A m² (`0.8318` Earth units), a moment that is positive from 0 to 0.5 Gyr, and `Passes the Gunell gate (dynamo_on): False`. Then `Valid` and `1 run(s)`.

That 6.7×10²² is about an Earth-strength moment. It is far below 2.5×10²⁴, so `dynamo_on` is false even though VPLanet's moment was positive for the first 0.5 billion years. Positive and protective are different.

### Install

The prompt should start with `(.venv)`. If it does not, go back to Get set up and activate the environment. Then install the pinned version from `challenge/requirements.txt` (the commented `vplanet==2.5.36` line):

```bash
python -m pip install "vplanet==2.5.36"
```

This compiles a C program. It needs a compiler and Python's header files. The first time can take a few minutes. The troubleshooting section covers the usual failures. While `(.venv)` is showing, `vplanet` is found without any extra PATH edit.

Check that the program is visible:

```bash
vplanet -h
```

You should see a help page that starts with `VPLanet is a general purpose planetary evolution integrator.` If the shell says `vplanet: command not found`, pip put the program in a user folder that is not on your `PATH`. On Mac or Linux:

```bash
export PATH="$HOME/.local/bin:$PATH"
vplanet -h
```

Add that `export` line to your shell startup file if you want it every time. On Windows, pip prints a `Scripts` path. Add that folder to Path, then open a new terminal.

### Run the template

```bash
cd challenge/vplanet/template
vplanet vpl.in
```

You should now see exactly these four lines:

```text
Log file written.
Evolution completed.
Log file updated.
Simulation completed.
```

The history is `marsdyn.mars.forward`. It should be 46 lines. The first number on the last line should be `4.500000` (4.5 billion years). Time in that file is in Gyr. The magnetic-moment column is in Earth units. Open `mars.in` in an editor and read the comments. They mark every knob.

```bash
cd ../../..
python3 challenge/vplanet_to_explorer.py challenge/vplanet/template -o challenge/output/vplanet_offline_run.json
python3 challenge/validate_offline_run.py challenge/output/vplanet_offline_run.json
node challenge/check_loads.mjs challenge/output/vplanet_offline_run.json
```

The `cd ../../..` returns to the repository root. Check with `ls package.json`. If that file is not listed, you are still inside `template` and the next commands will not find the scripts.

If you did not edit `mars.in`, the peak moment should again be about 6.65×10²² A m², positive through 0.5 Gyr, `dynamo_on` false.

Knobs inside `mars.in`, after the first successful run:

| Line | What to try |
| --- | --- |
| `dTMan 1600` | Mantle temperature. `1800` stands in for impact heat dumped in the mantle. |
| `dTCore 2750` | Core temperature. `3200` stands in for heat dumped in the core. |
| `dStagLid 1` | `1` is a stagnant lid (surface heat flow cut to 1/25). `0` is a mobile lid. |
| the four `PowerMan -0.11` lines | Radiogenic heating, in Earth-mantle units. `-0.11` is a Mars-mass scale. Change all four together. Try `-0.05` and `-0.30`. |
| `dTrefLind 1300` | Keeps the core from freezing at these temperatures. Delete the line to see the Earth melting curve freeze the core: the inner-core column (`RIC`) jumps and the moment goes to 0 immediately. |
| `# dViscRef 6e6` | Uncomment to try a weaker, wetter mantle. Then set `water_fraction` to `1` in `case.json`. |

`case.json` holds `impactor_diameter_m` and `water_fraction`. VPLanet does not read them. The converter copies them onto the website file so the page has a grid point. The template uses 1000 m and water 0, which are the website's starting sliders. There is no crater calculation inside VPLanet.

Core radius is not in this table. Stock ThermInt will not accept 1650, 1830, or 613.

## Troubleshooting

**`git: command not found` or `git is not recognized`.** On Mac, run `xcode-select --install` and open a new Terminal window. On Windows, install Git for Windows and open **Git Bash**, not Command Prompt.

**`xcode-select: note: install requested for command line developer tools` and then nothing.** A macOS dialog should appear. If it does not, run the command again. The install can take several minutes. When it finishes, `git --version` should print a version.

**`git clone` stops with `Permission denied` or `Repository not found`.** The address is the public repository `https://github.com/Andrew-MSU/mars-impact-fault-explorer.git`. Check the spelling. A personal access token is not required for this public clone.

**`ls package.json` says no such file.** You are not inside the project folder. Run `pwd`. If you cloned, `cd mars-impact-fault-explorer`. If you unzipped, the folder is often `mars-impact-fault-explorer-main` inside Downloads.

**`git pull` says `not a git repository`.** This folder came from Download ZIP. Git has no history there. Download a new ZIP, or clone with `git clone` into a new folder and use that copy from then on.

**`git pull` says `Your local changes would be overwritten`.** You edited a file Git is trying to update. Copy your edited file somewhere safe, or ask Andrew before you reset anything.

**`node: command not found` or `node is not recognized`.** Node is not installed, or the terminal was opened before the installer finished. Install Node 22 from nodejs.org, close the terminal, open a new one, and run `node --version` again. On Windows, use the new Git Bash window.

**`node --version` prints v16 or v18.** This repository's tests run on Node 22. Node 20 or newer runs the scripts. Install a current 22 LTS, or any current LTS of 22 or newer, and open a new terminal.

**`npm install` fails with `EACCES` or `permission denied`.** You do not need `sudo`. Run `npm install` from the repository folder as your own user. If a previous install used `sudo`, ask Andrew before changing ownership of system folders.

**`npm run dev` prints an address and then seems to hang.** It is waiting, on purpose. The site stays up until you press Ctrl+C.

**`python3: command not found`.** On Windows Git Bash, before the virtual environment is on, use `py -3 --version`. On Mac, install Python 3.12 from python.org if the command is missing. After `(.venv)` is showing, use `python` on both systems.

**`python -m venv .venv` says `ensurepip is not available`.** The Python install has no venv support. On Mac this sometimes means the Command Line Tools Python is a stub. Install Python 3.12 from python.org, open a new terminal, and run the venv command with that `python3`. On Ubuntu or Debian the message names the missing package: `sudo apt install python3.12-venv` (use the version `python3 --version` printed), then delete a half-made `.venv` folder and run the venv command again.

**The prompt does not show `(.venv)`.** The activate command did not run, or it was the other operating system's path. Mac is `source .venv/bin/activate`. Windows Git Bash is `source .venv/Scripts/activate`. Run it from the repository folder, where the `.venv` folder is.

**`pip install -r challenge/requirements.txt` says `No such file`.** You are not in the repository root. `ls challenge/requirements.txt` should print that path before you install.

**`pip install vplanet` ends with `Python.h: No such file or directory`.** The C compiler cannot see Python's headers. On Ubuntu or Debian: `sudo apt install python3-dev build-essential`, then run the pip command again. On Mac: `xcode-select --install`, then pip again. On Windows, the pip build needs the "Desktop development with C++" workload from Visual Studio Build Tools. This is the main reason the VPLanet path is optional. The first path does not compile anything.

**`pip install vplanet` ends with `Python.h: No such file or directory`.** The C compiler cannot see Python's headers. On Ubuntu or Debian: `sudo apt install python3-dev build-essential`, then run the pip command again. On Mac: `xcode-select --install`, then pip again. On Windows, the pip build needs the "Desktop development with C++" workload from Visual Studio Build Tools. This is the main reason the VPLanet path is optional. The first path does not compile anything.

**`vplanet: command not found` after a successful pip install.** Activate the virtual environment first (`(.venv)` on the prompt). The program is installed inside `.venv`. If you installed it outside that environment, Mac and Linux need `export PATH="$HOME/.local/bin:$PATH"`. Windows: the warning from pip names a `Scripts` directory. Add it to Path, or reinstall with the environment active.

**`ERROR: Could not open file vpl.in` or the forward file never appears.** `vplanet vpl.in` has to be run in `challenge/vplanet/template`, the directory that contains `vpl.in`, `mars.in`, and `sun.in`. From the repository root the command is `vplanet challenge/vplanet/template/vpl.in` only if your current directory is still the root and VPLanet can find the body files. The reliable way is to `cd` into the template directory.

**The forward file exists and the converter says a column is missing.** `mars.in` was edited so `saOutputOrder` no longer includes `-Time` and `-MagMom`. Put those two back. The template's output line is the one the converter expects.

**The validator says `example must be false`.** That file is the fake grid shipped in `data/offline_runs/EXAMPLE.json`. Point the validator at `challenge/output/baseline_offline_run.json`.

**The validator says the grid has a hole.** Every combination of impactor size and water needs a row. The default script writes all of them. A hand-edited JSON that drops one row will fail here. The website refuses to fill across a hole.

**A number in your answers is `NaN` or `Infinity`.** The website cannot read those tokens. The scripts write `null` for a missing time. Leave that as `null`.

**Mac `zsh` says permission denied on pip.** Activate `.venv` and use `python -m pip install "vplanet==2.5.36"`. Do not use `sudo pip`.

**You edited two knobs and the result moved.** Run again from the original file (the copy in `challenge/example/` matches the shipped default) and change one knob. Otherwise you cannot tell which edit did it.

## Next: the Mars Impact Fault Explorer

When the four answers are written, open the site:

[https://andrew-msu.github.io/mars-impact-fault-explorer/](https://andrew-msu.github.io/mars-impact-fault-explorer/)

The page is one screen. This is a short tour, in order.

1. Read the card at the top. Then open **About**. The two pathways there are the slow path and the fast path from your notes.
2. Click **Basin & Global** in the header. The globe replaces the regional terrain. The fault lines are the USGS map, the same catalog the command-line run used.
3. Find the epoch control, **Present day** and **Early Mars**. Your run used Early Mars. Switch to it. Elastic thickness on that setting is 15 km.
4. Find the three core buttons: **1650 km + melt**, **1830 km homogeneous**, **613 km inner core**. Click each one and watch the moment. That is the same comparison as your core table. 1650 km was the file you validated.
5. Move the impactor diameter. The regime map is the colored plot: faults slip, the lid breaks, or a protective dynamo turns on. Dynamo is drawn only when the retention tests pass, including the Gunell gate.
6. Move the water slider from dry to wet, or use the Dry and Wet buttons. Your table's regime goes from `slip` to `lid` when water goes from 0 to 1, and `dynamo_on` stays false. See whether the page tells the same story.
7. Place an impact on Hellas (the southern basin, near longitude 70°, latitude −42°). That is the site the command-line run used.

Optional, on your own computer, so you can see your file inside the page. Get set up already ran `npm install`. Copy your run into the folder the page reads, then start the site:

```bash
cp challenge/output/baseline_offline_run.json data/offline_runs/wheeler.json
npm run dev
```

If `npm run dev` says it cannot find `vite`, run `npm install` once from the repository folder and try again. The command prints a local address, usually `http://localhost:5173/`. Open it.

You should now see the same page, served from your checkout. Switch to **Basin & Global**. In the **Offline model** group, open **Offline file** and choose `wheeler.json`. Set the impactor to 1 km and water to dry. The offline block should show your `dynamo_on` value beside the browser estimate. Move water to the middle. The page should warn that neighboring runs disagree on the regime, because your dry rows are `slip` and your wet rows are `lid`. The loader refuses to blend those labels. That warning is the checkpoint for this step.

`EXAMPLE.json` in that same menu is a fake grid for testing the loader. Leave it. Do not cite it.

When you are finished looking, stop the dev server with Ctrl+C.

## Where the pieces live

| File | Role |
| --- | --- |
| `challenge/requirements.txt` | Python package list. The required list is empty. VPLanet is a commented pin. |
| `challenge/run_explorer_model.mjs` | The run. Edit the knobs at the top. |
| `challenge/validate_offline_run.py` | Checks the website's schema. |
| `challenge/check_loads.mjs` | Reads the file with the website's loader. |
| `challenge/vplanet/template/` | Optional VPLanet inputs. Comments in `mars.in` are the knobs. |
| `challenge/vplanet_to_explorer.py` | Turns a VPLanet `.forward` file into the same schema. |
| `challenge/example/` | A finished default run, so you can see the files before you produce them. |
| `src/model/globalScenario.js` | The equations the first path calls. |
| `MODEL.md` | The longer writeup of those equations, including the Gunell test. |
