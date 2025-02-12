import htmlnano from 'htmlnano';
import frontmatter from 'front-matter';
import {getHighlighter, loadTheme} from 'shiki';
import markdown from 'markdown-it';
import anchor, {AnchorInfo} from 'markdown-it-anchor';
import Token from 'markdown-it/lib/token';
// import Got from 'got';
import {existsSync} from 'fs';
import {mkdir, readdir, readFile, writeFile} from 'fs/promises';
import {join, resolve, basename, dirname} from 'path'

import {DocFile, DocPageLookup, LessonFile, LessonLookup, Section} from "../src/types";
import {create} from "domain";

export const docPages: DocPageLookup[] = [
  {
    subdir: ".",
    outputName: "api",
    combine: true
  },
  {
    subdir: "guides",
    outputName: "guides",
    combine: false
  },
]

type ProcessedMarkdown = {
  sections: Section[],
  html: string,
  attributes: any
}

const langsDir = resolve(__dirname, "../langs");

// Write the file to a specific path
export async function writeToPath(path: string, release: any) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(release, null, 2), {
    encoding: 'utf-8',
  });
}

export async function outputDocs(lang: string) {
  const langPath = join(langsDir, lang);

  const outputDir = resolve(__dirname, './out/docs', lang);

  // await mkdir(outputDir, { recursive: true });

  const createdResources = [];

  for ( const {subdir, outputName, combine} of docPages) {
    const path = join(langPath, subdir);
    if (combine) {
      const output = await processSections(path);
      const outputPath = join(outputDir, `${outputName}.json`);
      await writeToPath(outputPath, output);
      createdResources.push(outputName);
      continue;
    }

    const files = await mdInDir(path);

    const metadata: { [name: string]: object } = {};
    for (const [name, markdown] of Object.entries(files)) {
      const outputPath = join(outputDir, outputName, `${name}.json`);
      createdResources.push(`${outputName}/${name}`);
      await writeToPath(outputPath, markdown);
      metadata[name] = markdown.attributes;
    }
    await writeToPath(join(outputDir, outputName, `_metadata.json`), metadata);

  }

  return createdResources;
}

export async function outputTutorials(lang: string) {

  const tutorialsDir = join(langsDir, lang, "tutorials");

  const lookupPath = join(tutorialsDir, "directory.json");

  if (!existsSync(lookupPath)) {
    console.log("(tutorials don't exist)")
    return false;
  }

  const lookups: LessonLookup[] = await import(lookupPath);

  const combineTutorialFiles = async (name: string): Promise<LessonFile> => {
    const outputMap: { [filename: string]: keyof LessonFile } = {
      "lesson.json": "lesson",
      "solved.json": "solved",
      "lesson.md": "markdown"
    }

    const output: LessonFile = {};
    for (const [filename, outputKey] of Object.entries(outputMap)) {
      const filePath = join(tutorialsDir, name, filename);
      const fileContent = await readFile(filePath, {encoding: 'utf-8'});
      try {
        output[outputKey] = JSON.parse(fileContent);
      } catch (err) {
        output[outputKey] = fileContent;
      }
    }

    return output;
  }

  const outputDir = resolve(__dirname, './out/tutorials', lang);

  for (const lesson of lookups) {
    const output = await combineTutorialFiles(lesson.internalName);
    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }
    await writeToPath(join(outputDir,`${lesson.internalName}.json`), output);
  }

  await writeToPath(join(outputDir, "directory.json"), lookups);

  return lookups.map(({internalName}) => `tutorials/${internalName}`);
}

async function mdInDir(dirPath: string) {
  const mdFiles = (await readdir(dirPath))
    .filter(name => name.endsWith(".md") && name !== "README.md")
    .map(relative => join(dirPath, relative));

  let results: {
    [name: string]: ProcessedMarkdown
  } = {}

  for (const mdFile of mdFiles) {
    const fileContent = await readFile(mdFile, {encoding: 'utf-8'});
    const fileName = basename(mdFile, ".md");
    results[fileName] = (await processMarkdown(fileContent));
  }

  return results;
}

async function processSections(directoryPath: string): Promise<DocFile> {
  const results = Object.values(await mdInDir(directoryPath));

  results.sort(
    (a: any, b: any) => (
      a.attributes ? a.attributes.sort : 0) - (b.attributes ? b.attributes.sort : 0)
  );

  let html = '';
  let sections = [];
  for (let i in results) {
    html += results[i].html;
    sections.push(...results[i].sections);
  }

  return {
    sections,
    html
  }
}

// Parse individual markdown files
async function processMarkdown(mdToProcess: string): Promise<ProcessedMarkdown> {
  const { attributes, body } = frontmatter(mdToProcess);
  const theme = await loadTheme(resolve(__dirname, 'github-light.json'));
  const highlighter = await getHighlighter({ theme });
  const md = markdown({
    html: true,
    linkify: true,
    highlight(codeToHightlight, lang) {
      const language = lang === 'js' ? 'ts' : lang === 'jsx' ? 'tsx' : lang;
      return highlighter.codeToHtml(codeToHightlight, language);
    },
  });
  const sections: Section[] = [];
  const current: Array<Section | undefined> = Array(6).fill(undefined);
  md.use(anchor, {
    permalink: true,
    permalinkBefore: true,
    permalinkSymbol: '#',
    callback: (token: Token, { slug, title }: AnchorInfo) => {
      // h1 -> 1, h2 -> 2, etc.
      const level = Number.parseInt(token.tag[1], 10);
      const section: Section = { slug, title, level, children: [] };
      if (level === 1) {
        current[0] = section;
        sections.push(section);
        return;
      }
      if (!current[level - 2]) return;
      current[level - 1] = section;
      current[level - 2]!.children!.push(section);
    },
  });
  const renderedMarkdown = md.render(body)
  const optimizedMarkdown = (await htmlnano.process(renderedMarkdown)).html
  const html = '<section class="mt-10">' + optimizedMarkdown + '</section>';
  return { html, attributes, sections };
}
