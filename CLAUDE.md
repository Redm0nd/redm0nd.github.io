# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Jekyll-based personal blog hosted on GitHub Pages. The site uses the Minima theme with automatic light/dark mode switching and focuses on tech posts and travel content.

## Common Commands

### Development
- `bundle install` - Install Ruby dependencies
- `bundle exec jekyll serve` - Start local development server (typically runs on http://localhost:4000)
- `bundle exec jekyll build` - Build the site to `_site/` directory

### Testing and Validation
- `./script/cibuild` - Run the full CI build process (builds site and runs HTML validation)
- `bundle exec htmlproofer ./_site` - Validate HTML and check links after building

### Dependencies
- `bundle update` - Update gem dependencies
- `bundle update github-pages` - Update GitHub Pages gem specifically

## Architecture

### Site Structure
- `_posts/` - Blog posts in Markdown format with YYYY-MM-DD-title.markdown naming convention
- `_layouts/` - Jekyll layout templates (currently contains custom_page.html)
- `_config.yml` - Main Jekyll configuration file
- `travel/` - Travel-related content and pages
- `assets/` and `images/` - Static assets
- `_site/` - Generated site output (ignored by git)

### Content Organization
- Blog posts use Jekyll's standard front matter format
- Travel content is organized in a separate `travel/` directory with its own index page
- The site uses Jekyll's built-in pagination and feed generation

### Theme and Plugins
- Uses Minima theme v2.5.1 with GitHub Pages compatibility
- Key plugins: jekyll-feed, jekyll-seo-tag, jekyll-remote-theme
- Configured for automatic light/dark mode switching via Minima skin setting

### Deployment
- Automatically deployed via GitHub Pages on push to main branch
- Travis CI integration for build validation (legacy configuration present)
- HTML validation included in CI pipeline using html-proofer