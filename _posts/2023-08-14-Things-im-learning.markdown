---
layout: post
title:  "Some site updates"
date:   2023-08-14 20:12:30 +0100
categories: jekyll update
published: false
---

It's been a while since I've published here or worked with new tech over the years since being at AWS. 

Back in the day this site was being served from the `_site` dir in a static S3 Bucket. 

Since then, I've moved it to [GitHub Pages](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll) and it's served via GitHub Actions, which is ridiculously easy:

It used to be a free service for private repos, prior to the Microsoft take-over. Since then, they had started to charge $5/month to serve a **private** repo via GitHub pages. To avoid the charge, I've made this repo public on GitHub:

![GitHub Free Image](/images/github/free.jpg)


The Jekyll minima theme is here to stay. The new workflow for the site is tested locally via VS Code on my Mac Mini. 

To test locally, all you need to do is run `bundle install` once and from then on run, `bundle exec jekyll serve`. The site is then served on `http://localhost:4000`

